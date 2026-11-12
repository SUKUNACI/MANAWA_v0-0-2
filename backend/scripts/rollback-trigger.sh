#!/bin/bash

# Q78: Rollback Trigger & Monitoring Script
# Monitors system health metrics and automatically triggers rollbacks
# when thresholds are exceeded
#
# Usage: ./scripts/rollback-trigger.sh [--once|--daemon]
# Runs in daemon mode by default, checking health every 10 seconds

set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config/monitoring-thresholds.js"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/rollback-trigger-$(date +%Y-%m-%d).log"

# Load environment
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# Default mode
MODE="${1:-daemon}"
ONCE_ONLY=false

if [ "$MODE" = "--once" ]; then
  ONCE_ONLY=true
  MODE="once"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Logging
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

mkdir -p "${LOG_DIR}"

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

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Monitoring Functions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

get_system_metrics() {
  # Collect current system metrics
  # This calls Node.js to fetch metrics from monitoring endpoints

  node -e "
    const http = require('http');

    // Fetch from local monitoring endpoint
    http.get('http://localhost:4000/api/v1/monitoring/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(JSON.stringify(parsed, null, 2));
        } catch(e) {
          console.error('Failed to parse metrics');
          process.exit(1);
        }
      });
    }).on('error', (err) => {
      console.error('Failed to fetch metrics: ' + err.message);
      process.exit(1);
    });
  "
}

check_error_rate() {
  local error_rate="$1"
  local threshold="${ERROR_RATE_CRITICAL:-1.0}"

  if (( $(echo "$error_rate > $threshold" | bc -l) )); then
    log_warn "ERROR RATE THRESHOLD EXCEEDED: ${error_rate}% (threshold: ${threshold}%)"
    return 0
  fi
  return 1
}

check_latency() {
  local latency_p95="$1"
  local threshold="${LATENCY_P95_CRITICAL:-3000}"

  if [ "$latency_p95" -gt "$threshold" ]; then
    log_warn "LATENCY THRESHOLD EXCEEDED: ${latency_p95}ms (threshold: ${threshold}ms)"
    return 0
  fi
  return 1
}

check_memory() {
  local memory_percent="$1"
  local threshold="${MEMORY_CRITICAL:-85}"

  if [ "$memory_percent" -gt "$threshold" ]; then
    log_warn "MEMORY THRESHOLD EXCEEDED: ${memory_percent}% (threshold: ${threshold}%)"
    return 0
  fi
  return 1
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Rollback Logic
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

trigger_automatic_rollback() {
  local reason="$1"
  local metrics="$2"

  log_error "TRIGGERING AUTOMATIC ROLLBACK: $reason"
  log_info "Metrics: $metrics"

  # Call Node.js rollback manager
  node -e "
    const rollbackManager = require('./utils/rollback-manager');

    (async () => {
      try {
        const metrics = JSON.parse('${metrics}');
        const result = await rollbackManager.autoRollbackOnErrorSpike(metrics);
        console.log('Rollback initiated:', JSON.stringify(result, null, 2));
      } catch(err) {
        console.error('Rollback failed:', err.message);
        process.exit(1);
      }
    })();
  " || {
    log_error "Failed to trigger rollback"
    return 1
  }

  log_info "Automatic rollback triggered successfully"
  return 0
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Main Monitoring Loop
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_health_check() {
  log_info "Running health check..."

  # Fetch current metrics
  local metrics_json
  metrics_json=$(get_system_metrics) || {
    log_error "Failed to fetch system metrics"
    return 1
  }

  # Parse metrics
  local error_rate
  local latency_p95
  local memory_percent

  error_rate=$(echo "$metrics_json" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.data?.errorRate || 0)")
  latency_p95=$(echo "$metrics_json" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.data?.latencyP95 || 0)")
  memory_percent=$(echo "$metrics_json" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.data?.memoryUsage || 0)")

  log_info "Current metrics - Error Rate: ${error_rate}% | Latency P95: ${latency_p95}ms | Memory: ${memory_percent}%"

  # Check thresholds
  local should_rollback=false
  local rollback_reason=""

  if check_error_rate "$error_rate"; then
    should_rollback=true
    rollback_reason="Error rate spike detected (${error_rate}%)"
  fi

  if check_latency "$latency_p95"; then
    should_rollback=true
    rollback_reason="${rollback_reason:+$rollback_reason; }Latency spike detected (${latency_p95}ms)"
  fi

  if check_memory "$memory_percent"; then
    should_rollback=true
    rollback_reason="${rollback_reason:+$rollback_reason; }Memory threshold exceeded (${memory_percent}%)"
  fi

  # Trigger rollback if needed
  if [ "$should_rollback" = true ]; then
    trigger_automatic_rollback "$rollback_reason" "$metrics_json" || {
      log_error "Rollback trigger failed"
      return 1
    }
  fi

  return 0
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Daemon Loop
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_daemon() {
  log_info "Starting health monitoring daemon (check interval: 10s)"
  log_info "Press Ctrl+C to stop"

  while true; do
    run_health_check || {
      log_warn "Health check failed, will retry next interval"
    }

    # Wait before next check
    sleep 10
  done
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Main Entry Point
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

main() {
  log_info "═══════════════════════════════════════════════════════════"
  log_info "Q78: Rollback Trigger & Monitoring Script"
  log_info "Mode: $MODE"
  log_info "═══════════════════════════════════════════════════════════"

  # Validate environment
  if [ -z "${NODE_ENV:-}" ]; then
    log_error "NODE_ENV not set"
    exit 1
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    log_error "DATABASE_URL not set"
    exit 1
  fi

  # Run monitoring
  if [ "$ONCE_ONLY" = true ]; then
    log_info "Running single health check..."
    run_health_check || exit 1
    log_info "Health check completed"
  else
    run_daemon
  fi
}

# Trap signals for graceful shutdown
trap 'log_info "Shutting down..."; exit 0' SIGTERM SIGINT

# Run main
main "$@"
