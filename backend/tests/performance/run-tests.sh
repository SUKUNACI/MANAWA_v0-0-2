#!/bin/bash

# Performance Test Suite Runner for MANAWA Backend
#
# Runs baseline, peak, and stress tests with monitoring
#
# Usage: ./run-tests.sh [baseline|peak|stress|all]
#        BASE_URL=https://api.manawa.app ./run-tests.sh all

set -e

# Configuration
BASE_URL="${BASE_URL:-http://localhost:4000}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
TEST_TYPE="${1:-baseline}"
RESULTS_DIR="./results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Functions
print_header() {
  echo -e "\n${BOLD}${CYAN}=== $1 ===${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
  print_header "Checking Prerequisites"

  # Check if K6 is installed
  if ! command -v k6 &> /dev/null; then
    print_error "K6 is not installed"
    echo "Install from: https://k6.io/docs/getting-started/installation/"
    exit 1
  fi
  print_success "K6 found"

  # Check if backend is running
  if ! curl -s "$BASE_URL/api/health" > /dev/null 2>&1; then
    print_error "Backend is not running at $BASE_URL"
    echo "Start backend with: npm start"
    exit 1
  fi
  print_success "Backend is running at $BASE_URL"

  # Create results directory
  mkdir -p "$RESULTS_DIR"
  print_success "Results directory ready at $RESULTS_DIR"
}

# Run baseline test
run_baseline() {
  print_header "Running Baseline Test (100 VUs, 5 min)"

  local output_file="$RESULTS_DIR/baseline_${TIMESTAMP}.json"
  local log_file="$RESULTS_DIR/baseline_${TIMESTAMP}.log"

  echo "Output: $output_file"
  echo "Logging: $log_file"

  # Start system monitor
  node monitor.js \
    --duration 5m \
    --interval 5s \
    --output "$RESULTS_DIR/monitor_baseline_${TIMESTAMP}.json" &
  local monitor_pid=$!

  # Run K6 test
  BASE_URL="$BASE_URL" AUTH_TOKEN="$AUTH_TOKEN" \
    k6 run \
    --vus 100 \
    --duration 5m \
    -o "json=$output_file" \
    k6-load-test.js 2>&1 | tee "$log_file"

  # Wait for monitor to finish
  wait $monitor_pid

  print_success "Baseline test completed"

  # Analyze results
  if [ -f "$output_file" ]; then
    echo -e "\n${BOLD}Analyzing Results${NC}\n"
    node analyze-results.js "$output_file"
  fi
}

# Run peak test
run_peak() {
  print_header "Running Peak Test (ramp to 1000 VUs, 10 min)"

  local output_file="$RESULTS_DIR/peak_${TIMESTAMP}.json"
  local log_file="$RESULTS_DIR/peak_${TIMESTAMP}.log"

  echo "Output: $output_file"
  echo "Logging: $log_file"

  # Start system monitor
  node monitor.js \
    --duration 10m \
    --interval 5s \
    --output "$RESULTS_DIR/monitor_peak_${TIMESTAMP}.json" &
  local monitor_pid=$!

  # Run K6 test
  BASE_URL="$BASE_URL" AUTH_TOKEN="$AUTH_TOKEN" \
    k6 run \
    --stage 30s:100 \
    --stage 4m:1000 \
    --stage 30s:0 \
    -o "json=$output_file" \
    k6-load-test.js 2>&1 | tee "$log_file"

  # Wait for monitor to finish
  wait $monitor_pid

  print_success "Peak test completed"

  # Analyze results
  if [ -f "$output_file" ]; then
    echo -e "\n${BOLD}Analyzing Results${NC}\n"
    node analyze-results.js "$output_file"
  fi
}

# Run stress test
run_stress() {
  print_header "Running Stress Test (ramp to 5000 VUs, 4 min)"

  print_warning "This test will stress your system. Ensure proper monitoring is in place."
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_error "Stress test cancelled"
    return
  fi

  local output_file="$RESULTS_DIR/stress_${TIMESTAMP}.json"
  local log_file="$RESULTS_DIR/stress_${TIMESTAMP}.log"

  echo "Output: $output_file"
  echo "Logging: $log_file"

  # Start system monitor
  node monitor.js \
    --duration 4m \
    --interval 1s \
    --output "$RESULTS_DIR/monitor_stress_${TIMESTAMP}.json" &
  local monitor_pid=$!

  # Run K6 test
  BASE_URL="$BASE_URL" AUTH_TOKEN="$AUTH_TOKEN" \
    k6 run \
    --stage 1m:1000 \
    --stage 2m:5000 \
    --stage 1m:0 \
    -o "json=$output_file" \
    k6-load-test.js 2>&1 | tee "$log_file"

  # Wait for monitor to finish
  wait $monitor_pid

  print_success "Stress test completed"

  # Analyze results
  if [ -f "$output_file" ]; then
    echo -e "\n${BOLD}Analyzing Results${NC}\n"
    node analyze-results.js "$output_file"
  fi
}

# Run all tests
run_all() {
  print_header "Running Full Test Suite"

  run_baseline
  sleep 30
  echo ""
  run_peak
  sleep 30
  echo ""
  read -p "Run stress test? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    run_stress
  fi

  # Generate final report
  print_header "Final Report"
  echo -e "${BOLD}Results saved in: $RESULTS_DIR${NC}\n"

  echo "Test files:"
  ls -lh "$RESULTS_DIR" | grep -E "(baseline|peak|stress)" | tail -6

  echo -e "\n${BOLD}Next Steps:${NC}\n"
  echo "1. Review individual test results in $RESULTS_DIR"
  echo "2. Run analysis:"
  echo "   node analyze-results.js results/baseline_*.json results/peak_*.json results/stress_*.json"
  echo "3. Check system metrics:"
  echo "   cat $RESULTS_DIR/monitor_*.json | jq '.summary'"
}

# Main
main() {
  print_header "MANAWA Backend Performance Testing Suite"
  echo "Base URL: $BASE_URL"
  echo "Test Type: $TEST_TYPE"
  echo "Timestamp: $TIMESTAMP\n"

  check_prerequisites

  case "$TEST_TYPE" in
    baseline)
      run_baseline
      ;;
    peak)
      run_peak
      ;;
    stress)
      run_stress
      ;;
    all)
      run_all
      ;;
    *)
      print_error "Unknown test type: $TEST_TYPE"
      echo "Usage: $0 [baseline|peak|stress|all]"
      exit 1
      ;;
  esac

  print_success "Tests completed successfully"
}

# Run main
main
