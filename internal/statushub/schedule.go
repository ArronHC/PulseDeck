package statushub

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/models"
	messageevent "github.com/komari-monitor/komari/database/models/messageEvent"
	logger "github.com/komari-monitor/komari/utils/log"
	"gorm.io/gorm"
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
		wg.Go(func() { runQueue(ctx, time.Minute, 2, s.autoSpeedJobs) })
		wg.Go(func() { runQueue(ctx, time.Minute, 1, s.autoPurityJobs) })
		wg.Go(func() { runQueue(ctx, 5*time.Minute, 1, s.subscriptionAlertJobs) })
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

func (s *Service) autoSpeedJobs(ctx context.Context) ([]scheduledJob, error) {
	return s.subscriptionCheckJobs(ctx, "auto_speed_hours", "last_speed_attempt_at", "last_speed_test_at", func(ctx context.Context, id uint) error {
		_, err := s.CheckSpeed(ctx, SpeedInput{TestFilter: TestFilter{SubscriptionID: id}, Mode: "http", Concurrency: 4})
		return err
	})
}

func (s *Service) autoPurityJobs(ctx context.Context) ([]scheduledJob, error) {
	return s.subscriptionCheckJobs(ctx, "auto_purity_hours", "last_purity_attempt_at", "last_purity_check_at", func(ctx context.Context, id uint) error {
		_, err := s.CheckNodePurity(ctx, TestFilter{SubscriptionID: id})
		return err
	})
}

func (s *Service) subscriptionCheckJobs(ctx context.Context, intervalColumn, attemptColumn, completionColumn string, check func(context.Context, uint) error) ([]scheduledJob, error) {
	var sources []struct {
		ID          uint
		Hours       int
		AttemptedAt *time.Time
	}
	if err := s.dbFor(ctx).Model(&models.SubSource{}).
		Select("id", intervalColumn+" AS hours", attemptColumn+" AS attempted_at").
		Where("enabled = ? AND "+intervalColumn+" > 0", true).Order(attemptColumn + ", id").Find(&sources).Error; err != nil {
		return nil, err
	}
	now := s.now()
	var jobs []scheduledJob
	for _, source := range sources {
		interval := time.Duration(source.Hours) * time.Hour
		if source.AttemptedAt != nil && now.Sub(*source.AttemptedAt) < interval {
			continue
		}
		jobs = append(jobs, scheduledJob{source.ID, func(ctx context.Context) error {
			// Both automated tests use the same nodes. Let the other queue retry
			// on its next tick so it does not skip busy nodes.
			unlock, err := s.lock("subscription-auto-check", source.ID)
			if err != nil {
				return err
			}
			defer unlock()
			now := s.now()
			db := s.dbFor(ctx).Model(&models.SubSource{}).Where("id = ?", source.ID)
			claimed := db.Session(&gorm.Session{}).
				Where("enabled = ? AND "+intervalColumn+" = ?", true, source.Hours).
				Where("("+attemptColumn+" IS NULL OR "+attemptColumn+" <= ?)", now.Add(-interval)).
				Update(attemptColumn, now)
			if claimed.Error != nil || claimed.RowsAffected == 0 {
				return claimed.Error
			}
			if err := check(ctx, source.ID); err != nil {
				return err
			}
			return db.Update(completionColumn, s.now()).Error
		}})
	}
	return jobs, nil
}

func (s *Service) subscriptionAlertJobs(ctx context.Context) ([]scheduledJob, error) {
	const cooldown = 24 * time.Hour
	var sources []models.SubSource
	if err := s.dbFor(ctx).Select("id", "name", "expire", "expire_alert_days", "expire_alerted_at").
		Where("enabled = ? AND expire > 0 AND expire_alert_days > 0", true).
		Order("expire_alerted_at, expire, id").Find(&sources).Error; err != nil {
		return nil, err
	}
	now := s.now()
	var jobs []scheduledJob
	for _, source := range sources {
		expiry := time.Unix(source.Expire, 0).UTC()
		if expiry.Sub(now) > time.Duration(source.ExpireAlertDays)*24*time.Hour ||
			source.ExpireAlertedAt != nil && now.Sub(*source.ExpireAlertedAt) < cooldown {
			continue
		}
		jobs = append(jobs, scheduledJob{source.ID, func(ctx context.Context) error {
			now := s.now()
			claimed := s.dbFor(ctx).Model(&models.SubSource{}).
				Where("id = ? AND enabled = ? AND expire = ? AND expire_alert_days = ?", source.ID, true, source.Expire, source.ExpireAlertDays).
				Where("expire_alerted_at IS NULL OR expire_alerted_at <= ?", now.Add(-cooldown)).
				Update("expire_alerted_at", now)
			if claimed.Error != nil || claimed.RowsAffected == 0 {
				return claimed.Error
			}
			message := fmt.Sprintf("Subscription %q expires at %s.", source.Name, expiry.Format(time.RFC3339))
			if !expiry.After(now) {
				message = fmt.Sprintf("Subscription %q expired at %s.", source.Name, expiry.Format(time.RFC3339))
			}
			s.emitAlert(ctx, models.EventMessage{Event: messageevent.Expire, Time: now, Emoji: "⚠️"}, message)
			return nil
		}})
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
