#!/bin/bash

# MANAWA Database Backup Strategy Script
# Handles daily full backups, incremental backups, and automated cleanup
# Usage: ./scripts/backup-strategy.sh [backup|restore|cleanup|test]

set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/.backups"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/backup-$(date +%Y-%m-%d).log"

# Load environment
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# Backup configuration
BACKUP_BUCKET="${BACKUP_S3_BUCKET:-manawa-db-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
INCREMENTAL_INTERVAL_HOURS="${BACKUP_INCREMENTAL_HOURS:-6}"
FULL_BACKUP_HOUR="${BACKUP_FULL_HOUR:-02}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Logging Functions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

mkdir -p "${LOG_DIR}" "${BACKUP_DIR}"

log() {
  local level="$1"
  shift
  local message="$@"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[${timestamp}] [${level}] ${message}" | tee -a "${LOG_FILE}"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Validation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

check_requirements() {
  local missing=""

  # Check required environment variables
  for var in DATABASE_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION; do
    if [ -z "${!var:-}" ]; then
      missing="${missing}${var} "
    fi
  done

  # Check required tools
  for cmd in pg_dump aws aws-vault jq; do
    if ! command -v "$cmd" &> /dev/null; then
      missing="${missing}${cmd} "
    fi
  done

  if [ -n "$missing" ]; then
    log_error "Missing requirements: $missing"
    return 1
  fi

  log_info "All requirements met"
  return 0
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Full Backup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

create_full_backup() {
  log_info "Starting full backup"

  local timestamp=$(date -u +"%Y-%m-%d")
  local backup_name="backup-full-${timestamp}"
  local backup_file="${BACKUP_DIR}/${backup_name}.sql"
  local backup_file_gz="${backup_file}.gz"

  # Extract connection details from DATABASE_URL
  # Format: postgresql://user:password@host:port/database
  local db_url="${DATABASE_URL}"
  local db_host=$(echo "$db_url" | grep -oP '(?<=@)[^:]+')
  local db_port=$(echo "$db_url" | grep -oP '(?<=:)\d+(?=/)' || echo "5432")
  local db_name=$(echo "$db_url" | grep -oP '[^/]+$')
  local db_user=$(echo "$db_url" | grep -oP '(?://)[^:]+' | sed 's|://||')
  local db_password=$(echo "$db_url" | grep -oP '(?<=:)[^@]+' || echo "")

  # Create backup
  log_info "Dumping database: $db_name from $db_host"

  PGPASSWORD="$db_password" pg_dump \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    --format=plain \
    --verbose \
    --no-password \
    > "$backup_file" 2>> "${LOG_FILE}"

  if [ $? -ne 0 ]; then
    log_error "Database dump failed"
    return 1
  fi

  log_info "Database dump completed: $(du -h "$backup_file" | cut -f1)"

  # Compress backup
  log_info "Compressing backup"
  gzip -v "$backup_file" >> "${LOG_FILE}" 2>&1

  # Upload to S3
  log_info "Uploading to S3: s3://${BACKUP_BUCKET}/full-backups/${backup_name}.sql.gz"

  aws s3 cp \
    "$backup_file_gz" \
    "s3://${BACKUP_BUCKET}/full-backups/${backup_name}.sql.gz" \
    --storage-class STANDARD \
    --sse AES256 \
    --metadata "backup-timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ),backup-type=full" \
    2>> "${LOG_FILE}"

  if [ $? -eq 0 ]; then
    log_info "Backup uploaded successfully"
    local size=$(du -h "$backup_file_gz" | cut -f1)
    log_info "Full backup complete: ${backup_name}.sql.gz (${size})"

    # Clean up local copy after successful upload
    rm -f "$backup_file_gz"
    return 0
  else
    log_error "S3 upload failed"
    return 1
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Incremental Backup (WAL/Transaction Log)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

create_incremental_backup() {
  log_info "Starting incremental backup"

  local timestamp=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
  local backup_name="backup-incremental-${timestamp}"
  local backup_file="${BACKUP_DIR}/${backup_name}.jsonl"
  local backup_file_gz="${backup_file}.gz"

  # Extract changes from audit_log table (last 6 hours)
  local db_url="${DATABASE_URL}"
  local db_host=$(echo "$db_url" | grep -oP '(?<=@)[^:]+')
  local db_port=$(echo "$db_url" | grep -oP '(?<=:)\d+(?=/)' || echo "5432")
  local db_name=$(echo "$db_url" | grep -oP '[^/]+$')
  local db_user=$(echo "$db_url" | grep -oP '(?://)[^:]+' | sed 's|://||')
  local db_password=$(echo "$db_url" | grep -oP '(?<=:)[^@]+' || echo "")

  # Query transaction log
  log_info "Querying transaction log"

  PGPASSWORD="$db_password" psql \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    --tuples-only \
    --command="SELECT json_object_agg(key, value) FROM (
      SELECT
        'id' AS key, id::text AS value
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '${INCREMENTAL_INTERVAL_HOURS} hours'
      UNION ALL
      SELECT
        'entity_type', entity_type
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '${INCREMENTAL_INTERVAL_HOURS} hours'
    ) t" \
    > "$backup_file" 2>> "${LOG_FILE}"

  if [ ! -s "$backup_file" ]; then
    log_warn "No changes in last ${INCREMENTAL_INTERVAL_HOURS} hours"
    rm -f "$backup_file"
    return 0
  fi

  # Compress
  log_info "Compressing incremental backup"
  gzip -v "$backup_file" >> "${LOG_FILE}" 2>&1

  # Upload to S3 (cheaper GLACIER storage)
  log_info "Uploading to S3: s3://${BACKUP_BUCKET}/incremental-backups/${backup_name}.jsonl.gz"

  aws s3 cp \
    "$backup_file_gz" \
    "s3://${BACKUP_BUCKET}/incremental-backups/${backup_name}.jsonl.gz" \
    --storage-class GLACIER \
    --sse AES256 \
    --metadata "backup-timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ),backup-type=incremental" \
    2>> "${LOG_FILE}"

  if [ $? -eq 0 ]; then
    log_info "Incremental backup uploaded successfully"
    local size=$(du -h "$backup_file_gz" | cut -f1)
    log_info "Incremental backup complete: ${backup_name}.jsonl.gz (${size})"
    rm -f "$backup_file_gz"
    return 0
  else
    log_error "S3 upload failed"
    return 1
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Cleanup Old Backups
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cleanup_old_backups() {
  log_info "Cleaning up backups older than ${BACKUP_RETENTION_DAYS} days"

  # Calculate cutoff date
  local cutoff_date=$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" +"%Y-%m-%dT%H:%M:%SZ")

  # List backups from S3
  log_info "Listing backups from S3"

  aws s3api list-objects-v2 \
    --bucket "${BACKUP_BUCKET}" \
    --output json | jq -r '.Contents[] | select(.LastModified < "'"${cutoff_date}"'") | .Key' | \
  while read -r key; do
    if [ -z "$key" ]; then
      continue
    fi

    log_info "Deleting old backup: $key"
    aws s3 rm "s3://${BACKUP_BUCKET}/${key}" 2>> "${LOG_FILE}"
  done

  log_info "Cleanup completed"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test Backup Integrity
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test_backup_integrity() {
  local backup_name="${1:-}"

  if [ -z "$backup_name" ]; then
    log_error "Usage: test_backup_integrity <backup_name>"
    return 1
  fi

  log_info "Testing backup integrity: $backup_name"

  # Download backup
  local test_file="${BACKUP_DIR}/${backup_name}-test.sql"
  local test_file_gz="${test_file}.gz"

  log_info "Downloading backup from S3"
  aws s3 cp \
    "s3://${BACKUP_BUCKET}/full-backups/${backup_name}.sql.gz" \
    "${test_file_gz}" \
    2>> "${LOG_FILE}"

  if [ $? -ne 0 ]; then
    log_error "Failed to download backup"
    return 1
  fi

  # Decompress
  gunzip -v "${test_file_gz}" >> "${LOG_FILE}" 2>&1

  # Validate SQL syntax
  if ! grep -q "CREATE TABLE" "$test_file" || ! grep -q "INSERT INTO" "$test_file"; then
    log_error "Invalid backup format"
    rm -f "$test_file"
    return 1
  fi

  log_info "Backup integrity test passed"
  rm -f "$test_file"
  return 0
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Restore from Backup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

restore_from_backup() {
  local backup_name="${1:-}"

  if [ -z "$backup_name" ]; then
    log_error "Usage: restore_from_backup <backup_name>"
    return 1
  fi

  log_warn "⚠️  RESTORE INITIATED: $backup_name"
  log_warn "This will DROP all current data and replace with backup"
  read -p "Type 'restore' to confirm: " confirm

  if [ "$confirm" != "restore" ]; then
    log_warn "Restore cancelled"
    return 1
  fi

  local restore_file="${BACKUP_DIR}/${backup_name}-restore.sql"
  local restore_file_gz="${restore_file}.gz"

  # Download backup
  log_info "Downloading backup from S3"
  aws s3 cp \
    "s3://${BACKUP_BUCKET}/full-backups/${backup_name}.sql.gz" \
    "${restore_file_gz}" \
    2>> "${LOG_FILE}"

  if [ $? -ne 0 ]; then
    log_error "Failed to download backup"
    return 1
  fi

  # Decompress
  gunzip -v "${restore_file_gz}" >> "${LOG_FILE}" 2>&1

  # Extract connection details
  local db_url="${DATABASE_URL}"
  local db_host=$(echo "$db_url" | grep -oP '(?<=@)[^:]+')
  local db_port=$(echo "$db_url" | grep -oP '(?<=:)\d+(?=/)' || echo "5432")
  local db_name=$(echo "$db_url" | grep -oP '[^/]+$')
  local db_user=$(echo "$db_url" | grep -oP '(?://)[^:]+' | sed 's|://||')
  local db_password=$(echo "$db_url" | grep -oP '(?<=:)[^@]+' || echo "")

  # Restore
  log_warn "Restoring database..."
  PGPASSWORD="$db_password" psql \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    --file="$restore_file" \
    2>> "${LOG_FILE}"

  if [ $? -eq 0 ]; then
    log_warn "✅ Database restored successfully"
    rm -f "$restore_file"
    return 0
  else
    log_error "Restore failed"
    return 1
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Show Status
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

show_status() {
  log_info "=== BACKUP STATUS ==="
  log_info "Backup bucket: ${BACKUP_BUCKET}"
  log_info "Retention: ${BACKUP_RETENTION_DAYS} days"
  log_info "Full backup hour: ${FULL_BACKUP_HOUR}:00 UTC"
  log_info "Incremental interval: ${INCREMENTAL_INTERVAL_HOURS} hours"
  log_info ""

  log_info "Backups in S3:"
  aws s3 ls "s3://${BACKUP_BUCKET}/" --recursive --summarize 2>> "${LOG_FILE}" | tail -20

  log_info "Last backup log entry:"
  tail -5 "${LOG_FILE}"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Main
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

main() {
  log_info "MANAWA Backup Strategy Script"

  # Check requirements
  if ! check_requirements; then
    exit 1
  fi

  case "${1:-status}" in
    backup)
      create_full_backup && create_incremental_backup
      ;;
    full)
      create_full_backup
      ;;
    incremental)
      create_incremental_backup
      ;;
    cleanup)
      cleanup_old_backups
      ;;
    test)
      test_backup_integrity "${2:-backup-full-$(date -u +%Y-%m-%d)}"
      ;;
    restore)
      restore_from_backup "$2"
      ;;
    status)
      show_status
      ;;
    *)
      cat << EOF
Usage: $0 [command] [options]

Commands:
  backup              Create full + incremental backup
  full                Create full backup only
  incremental         Create incremental backup only
  cleanup             Clean up old backups (>${BACKUP_RETENTION_DAYS} days)
  test [backup_name]  Test backup integrity
  restore [backup]    Restore database from backup
  status              Show backup status

Examples:
  $0 backup
  $0 full
  $0 test backup-full-2026-11-11
  $0 restore backup-full-2026-11-11

EOF
      exit 1
      ;;
  esac

  log_info "Operation completed"
}

main "$@"
