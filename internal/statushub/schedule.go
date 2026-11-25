package statushub

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/models"
	logger "github.com/komari-monitor/komari/utils/log"
)

const schedulerInterval = time.Second

// Start runs independent queues for local checks and remote refreshes so a
// slow subscription provider cannot delay an uptime check.
func (s *Service) Start() func(context.Context) error {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		var wg sync.WaitGroup
		wg.Go(func() { runQueue(ctx, schedulerInterval, checkLimit, s.monitorJobs) })
		wg.Go(func() { runQueue(ctx, 10*time.Second, 4, s.kumaJobs) })
		wg.Go(func() { runQueue(ctx, time.Minute, 4, s.subscriptionJobs) })
		wg.Go(func() { runQueue(ctx, time.Hour, 1, s.retentionJobs) })
		wg.Wait()
	}()
	return func(ctx context.Context) error {
		cancel()
		select {
		case <-done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type scheduledJob struct {
	id  uint
	run func(context.Context) error
}

func runQueue(ctx context.Context, interval time.Duration, limit int, jobs func(context.Context) ([]scheduledJob, error)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var wg sync.WaitGroup
	defer wg.Wait()
	slots := make(chan struct{}, limit)
	var active sync.Map
	for ctx.Err() == nil {
		if len(slots) < cap(slots) {
			due, err := jobs(ctx)
			if jobError(err) {
				logger.Errorf("status-hub", "Failed to select scheduled work")
			}
			for _, job := range due {
				if len(slots) == cap(slots) || ctx.Err() != nil {
					break
				}
				if _, busy := active.LoadOrStore(job.id, struct{}{}); busy {
					continue
				}
				slots <- struct{}{}
				wg.Go(func() {
					defer func() {
						active.Delete(job.id)
						<-slots
					}()
					if err := job.run(ctx); jobError(err) {
						var input InputError
						if errors.As(err, &input) {
							logger.Warnf("status-hub", "Scheduled operation for ID %d failed: %v", job.id, input)
						} else {
							logger.Errorf("status-hub", "Scheduled operation for ID %d failed", job.id)
						}
					}
				})
			}
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
		}
	}
}

func (s *Service) monitorJobs(ctx context.Context) ([]scheduledJob, error) {
	var monitors []models.UptimeMonitor
	if err := s.dbFor(ctx).Select("id", "interval_sec", "last_check_at").Where("enabled = ? AND kuma_source_id IS NULL", true).
		Order("last_check_at, id").Find(&monitors).Error; err != nil {
		return nil, err
	}
	now := s.now()
	var jobs []scheduledJob
	for _, m := range monitors {
		if monitorDue(m, now) {
			jobs = append(jobs, scheduledJob{m.ID, func(ctx context.Context) error {
				_, err := s.CheckMonitor(ctx, m.ID, false)
				return err
			}})
		}
	}
	return jobs, nil
}

func (s *Service) kumaJobs(ctx context.Context) ([]scheduledJob, error) {
	var sources []models.UptimeKumaSource
	if err := s.dbFor(ctx).Select("id", "last_attempt_at").Where("enabled = ?", true).Order("last_attempt_at, id").Find(&sources).Error; err != nil {
		return nil, err
	}
	now := s.now()
	var jobs []scheduledJob
	for _, source := range sources {
		if kumaDue(source, now) {
			jobs = append(jobs, scheduledJob{source.ID, func(ctx context.Context) error {
				_, err := s.SyncKuma(ctx, source.ID, false)
				return err
			}})
		}
	}
	return jobs, nil
}

func (s *Service) subscriptionJobs(ctx context.Context) ([]scheduledJob, error) {
	var sources []models.SubSource
	if err := s.dbFor(ctx).Select("id", "auto_update_hours", "last_attempt_at").
		Where("enabled = ? AND source_type = ? AND auto_update_hours > 0", true, "url").Order("last_attempt_at, id").Find(&sources).Error; err != nil {
		return nil, err
	}
	now := s.now()
	var jobs []scheduledJob
	for _, source := range sources {
		if subscriptionDue(source, now) {
			jobs = append(jobs, scheduledJob{source.ID, func(ctx context.Context) error {
				_, err := s.RefreshSubscription(ctx, source.ID, false)
				return err
			}})
		}
	}
	return jobs, nil
}

func (s *Service) retentionJobs(_ context.Context) ([]scheduledJob, error) {
	return []scheduledJob{{0, func(ctx context.Context) error {
		db := s.dbFor(ctx)
		cutoff := s.now().Add(-retention)
		beatErr := db.Where("checked_at < ?", cutoff).Delete(&models.UptimeHeartbeat{}).Error
		speedErr := db.Where("tested_at < ?", cutoff).Delete(&models.SubSpeedSample{}).Error
		return errors.Join(beatErr, speedErr)
	}}}, nil
}
