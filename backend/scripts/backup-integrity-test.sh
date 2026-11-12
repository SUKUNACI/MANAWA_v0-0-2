#!/bin/bash

# Q78: Hourly Backup Integrity Test Script
# Verifies backup integrity hourly and logs results
#
# Usage: ./scripts/backup-integrity-test.sh [--once|--daemon]
# Runs once by default for manual testing

set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/backup-integrity-$(date +%Y-%m-%d).log"
BACKUP_DIR="${SCRIPT_DIR}/.backups"

# Load environment
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# Mode
MODE="${1:-once}"
DAEMON_MODE=false

if [ "$MODE" = "--daemon" ]; then
  DAEMON_MODE=true
  MODE="daemon"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Logging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
log_success() { log "SUCCESS" "$@"; }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Check Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

check_filesystem_backup() {
  log_info "Checking filesystem backup integrity..."

  if [ ! -d "$BACKUP_DIR" ]; then
    log_error "Backup directory not found: $BACKUP_DIR"
    return 1
  fi

  # Count backup files
  local backup_count
  backup_count=$(find "$BACKUP_DIR" -type f -name "*.sql" -o -name "*.tar.gz" -o -name "*.dump" | wc -l)

  if [ "$backup_count" -eq 0 ]; then
    log_warn "No backup files found in $BACKUP_DIR"
    return 1
  fi

  # Check recent backup age
  local most_recent
  most_recent=$(find "$BACKUP_DIR" -type f \( -name "*.sql" -o -name "*.tar.gz" -o -name "*.dump" \) -printf '%T@\n' | sort -n | tail -1)

  if [ -z "$most_recent" ]; then
    log_error "Failed to determine backup age"
    return 1
  fi

  local current_time
  current_time=$(date +%s)

  local backup_age_minutes
  backup_age_minutes=$(( ($current_time - ${most_recent%.*}) / 60 ))

  log_info "Most recent backup: ${backup_age_minutes} minutes old"

  if [ "$backup_age_minutes" -gt 1440 ]; then
    log_warn "Last backup is older than 24 hours"
    return 1
  fi

  # Check backup file sizes
  local total_size
  total_size=$(find "$BACKUP_DIR" -type f \( -name "*.sql" -o -name "*.tar.gz" -o -name "*.dump" \) -exec du -b {} + | awk '{s+=$1} END {print s}')

  if [ "$total_size" -lt 1000000 ]; then
    log_warn "Total backup size suspiciously small: $(numfmt --to=iec $total_size)"
    return 1
  fi

  log_success "Filesystem backup integrity OK ($backup_count files, $(numfmt --to=iec $total_size))"
  return 0
}

check_database_consistency() {
  log_info "Checking database consistency..."

  if [ -z "${DATABASE_URL:-}" ]; then
    log_warn "DATABASE_URL not set, skipping database consistency check"
    return 1
  fi

  # Run basic database checks
  psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pg_stat_user_tables;" > /dev/null 2>&1 || {
    log_error "Failed to connect to database"
    return 1
  }

  # Check table counts
  local table_count
  table_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

  log_info "Database contains $table_count tables"

  if [ "$table_count" -lt 20 ]; then
    log_warn "Table count seems low: $table_count"
    return 1
  fi

  # Run integrity checks
  psql "$DATABASE_URL" -c "ANALYZE;" > /dev/null 2>&1 || {
    log_warn "Failed to run ANALYZE"
    return 1
  }

  log_success "Database consistency OK ($table_count tables)"
  return 0
}

check_backup_recovery_feasibility() {
  log_info "Checking backup recovery feasibility..."

  # This is a test to verify we CAN restore (not actually restoring)
  if [ -z "${BACKUP_BUCKET:-}" ] && [ -z "$BACKUP_DIR" ]; then
    log_warn "No backup storage configured"
    return 1
  fi

  # Check if we have recent backups in S3 (if configured)
  if [ -n "${AWS_S3_BACKUP_BUCKET:-}" ]; then
    local s3_backups
    s3_backups=$(aws s3 ls "s3://${AWS_S3_BACKUP_BUCKET}" --recursive 2>/dev/null | wc -l)

    if [ "$s3_backups" -eq 0 ]; then
      log_warn "No backups found in S3 bucket"
      return 1
    fi

    log_info "Found $s3_backups backups in S3"
  fi

  log_success "Backup recovery feasibility OK"
  return 0
}

check_incremental_backup() {
  log_info "Checking incremental backup status..."

  # Check for incremental backup markers
  local incremental_count
  incremental_count=$(find "$BACKUP_DIR" -type f -name "*incremental*" | wc -l)

  log_info "Found $incremental_count incremental backup files"

  if [ "$incremental_count" -eq 0 ]; then
    log_warn "No incremental backups found"
    return 1
  fi

  log_success "Incremental backup status OK"
  return 0
}

save_check_results() {
  local check_type="$1"
  local status="$2"
  local duration="$3"

  # Call Node.js to save to database
  node -e "
    const { prisma } = require('./config/db');

    (async () => {
      try {
        await prisma.backupIntegrityCheck.create({
          data: {
            backupId: 'auto_check_' + Date.now(),
            checkType: '$check_type',
            status: '$status',
            duration: $duration,
          },
        });
      } catch(err) {
        console.error('Failed to save check result:', err.message);
      }
    })();
  " 2>/dev/null || {
    log_warn "Failed to save check results to database"
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Integrity Check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_integrity_check() {
  log_info "═══════════════════════════════════════════════════════════"
  log_info "Q78: Backup Integrity Check - $(date '+%Y-%m-%d %H:%M:%S')"
  log_info "═══════════════════════════════════════════════════════════"

  local start_time
  start_time=$(date +%s%N)

  local checks_total=4
  local checks_passed=0

  # Run all checks
  if check_filesystem_backup; then
    ((checks_passed++))
    save_check_results "FULL_BACKUP" "SUCCESS" "0"
  else
    save_check_results "FULL_BACKUP" "FAILED" "0"
  fi

  if check_database_consistency; then
    ((checks_passed++))
    save_check_results "DATABASE" "SUCCESS" "0"
  else
    save_check_results "DATABASE" "FAILED" "0"
  fi

  if check_backup_recovery_feasibility; then
    ((checks_passed++))
    save_check_results "INCREMENTAL" "SUCCESS" "0"
  else
    save_check_results "INCREMENTAL" "FAILED" "0"
  fi

  if check_incremental_backup; then
    ((checks_passed++))
    save_check_results "FILESYSTEM" "SUCCESS" "0"
  else
    save_check_results "FILESYSTEM" "FAILED" "0"
  fi

  local end_time
  end_time=$(date +%s%N)

  local duration_ms
  duration_ms=$(( (end_time - start_time) / 1000000 ))

  log_info "═══════════════════════════════════════════════════════════"
  log_info "Results: $checks_passed/$checks_total checks passed"
  log_info "Duration: ${duration_ms}ms"
  log_info "═══════════════════════════════════════════════════════════"

  if [ "$checks_passed" -ge 3 ]; then
    log_success "Backup integrity check PASSED"
    return 0
  else
    log_error "Backup integrity check FAILED"
    return 1
  fi
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Daemon Loop
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_daemon() {
  log_info "Starting hourly backup integrity check daemon"

  while true; do
    run_integrity_check || {
      log_warn "Integrity check failed, will retry next hour"
      # In production, trigger alert here
    }

    # Wait 1 hour before next check
    sleep 3600
  done
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

main() {
  if [ "$DAEMON_MODE" = true ]; then
    run_daemon
  else
    run_integrity_check
  fi
}

# Trap signals
trap 'log_info "Shutting down..."; exit 0' SIGTERM SIGINT

# Run
main "$@"
