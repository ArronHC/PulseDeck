package admin

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/auditlog"
	logger "github.com/komari-monitor/komari/utils/log"
	"github.com/komari-monitor/komari/web/backup"
	"github.com/komari-monitor/komari/web/upload"
)

func NewArchiveUploadHandler() *upload.Handler {
	h := upload.NewHandler(upload.DefaultStore, map[upload.Purpose]upload.Finalizer{
		upload.PurposeBackup: finalizeBackupUpload,
	})
	h.OnMerged = auditArchiveUpload
	return h
}

func auditArchiveUpload(c *gin.Context, session upload.Session, _ upload.Result) {
	ip := c.ClientIP()
	actor := c.GetString("uuid")
	filename := session.Metadata.Filename
	size := auditlog.FormatBytes(session.Metadata.Size)
	auditlog.Log(ip, actor, fmt.Sprintf("Upload backup archive for restore: file=%s, size=%s", filename, size), "warn")
}

func finalizeBackupUpload(session upload.Session) (upload.Result, error) {
	restoreLock, err := backup.AcquireRestoreLock()
	if err != nil {
		return upload.Result{}, err
	}
	archive, err := os.Open(session.ArchivePath)
	if err != nil {
		restoreLock.Release()
		return upload.Result{}, fmt.Errorf("open merged backup: %w", err)
	}
	if err := restoreLock.SaveUploadedBackup(archive, session.Metadata.Filename); err != nil {
		_ = archive.Close()
		restoreLock.Release()
		return upload.Result{}, err
	}
	if err := archive.Close(); err != nil {
		restoreLock.Release()
		return upload.Result{}, fmt.Errorf("close merged backup: %w", err)
	}

	go func() {
		logger.InfoArgs("admin-api", "Backup uploaded, restarting service in 2 seconds to apply on startup...")
		time.Sleep(2 * time.Second)
		restoreLock.Release()
		os.Exit(0)
	}()

	return upload.Result{
		Message: "Backup uploaded successfully. The service will restart and apply the backup.",
		Data:    map[string]string{"path": filepath.Join(".", "data", "backup.zip")},
	}, nil
}
