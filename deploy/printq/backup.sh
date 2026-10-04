#!/usr/bin/env bash
# Nightly PrintQ backup: database dump + uploads, kept 7 days locally.
# Copy the output directory off the server (e.g. rclone to an R2 bucket).
set -euo pipefail
BACKUP_DIR=${BACKUP_DIR:-/var/backups/printq}
UPLOAD_DIR=${PRINTQ_UPLOAD_DIR:-/var/lib/printq/uploads}
STAMP=$(date +%F)
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --schema=printq "$DATABASE_URL" > "$BACKUP_DIR/printq-$STAMP.dump"
tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$UPLOAD_DIR" .
find "$BACKUP_DIR" -type f -mtime +7 -delete
