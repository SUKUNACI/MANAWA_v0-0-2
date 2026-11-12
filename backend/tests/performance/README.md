# Performance & Load Testing - MANAWA Backend

Comprehensive performance testing suite using K6, Artillery, and JMeter for the MANAWA backend API.

## Overview

This testing suite provides three escalating load scenarios:
- **Baseline**: 100 concurrent users, 5 minutes - normal operating conditions
- **Peak**: 1000 concurrent users, 10 minutes - peak load conditions  
- **Stress**: 5000 concurrent users - until system breaks

## Performance Thresholds

| Endpoint | Metric | Target | P95 Threshold |
|----------|--------|--------|--------------|
| GET /api/projects | Response time | <500ms | <500ms |
| POST /api/bookings | Response time | <1s | <1s |
| GET /api/search | Response time | <2s | <2s |
| GET /api/professionals | Response time | <1s | <1s |
| Error Rate | System-wide | <1% | <1% |

## Tools

### K6 (Recommended for baseline/peak)
Modern, script-based load testing with excellent metrics collection.

**Installation:**
```bash
# macOS
brew install k6

# Linux
apt-get install k6

# Windows (Chocolatey)
choco install k6
```

**Usage:**

```bash
# Baseline (100 VUs, 5 min)
k6 run --vus 100 --duration 5m k6-load-test.js

# Peak (ramp up to 1000 VUs)
k6 run --stage 30s:100 --stage 4m:1000 --stage 30s:0 k6-load-test.js

# Stress (up to 5000 VUs)
k6 run --stage 1m:1000 --stage 2m:5000 --stage 1m:0 k6-load-test.js

# With custom target
BASE_URL=https://api.manawa.app AUTH_TOKEN=your_token k6 run k6-load-test.js

# Generate report
k6 run -o json=results.json k6-load-test.js
k6 run -o cloud k6-load-test.js  # Upload to k6 Cloud
```

**Output:**
- Console summary with p50/p95/p99 response times
- JSON results saved to `k6-results.json`

### Artillery (Good for peak/stress)
Node.js-based load testing with YAML configuration.

**Installation:**
```bash
npm install -g artillery
```

**Usage:**

```bash
# Baseline scenario
artillery run artillery-config.yaml --target "http://localhost:4000" --scenario baseline

# Peak scenario
artillery run artillery-config.yaml --target "http://localhost:4000" --scenario peak

# Stress scenario
artillery run artillery-config.yaml --target "http://localhost:4000" --scenario stress

# Generate HTML report
artillery report artillery-results.json --output report.html
```

**Output:**
- Console summary
- JSON results file
- HTML report with detailed metrics

### JMeter (Enterprise-grade)
Java-based tool with GUI, best for complex scenarios and enterprise monitoring.

**Installation:**
```bash
# macOS
brew install jmeter

# Download from: https://jmeter.apache.org/download_jmeter.cgi
```

**Usage:**

```bash
# Run from command line
jmeter -n -t jmeter-scenarios.jmx -l results.jtl -j jmeter.log

# Run with GUI
jmeter -t jmeter-scenarios.jmx

# Generate HTML report
jmeter -g results.jtl -o report/
```

## Metrics Collected

### Response Time Percentiles
- **p50**: 50th percentile (median)
- **p95**: 95th percentile (acceptable for most users)
- **p99**: 99th percentile (tail latency)
- **avg**: Average response time
- **max**: Maximum observed response time

### Throughput
- **req/sec**: Requests per second
- **success_count**: Total successful requests
- **failure_count**: Total failed requests
- **error_rate**: Percentage of failed requests

### Infrastructure Metrics (from monitoring)
- **CPU usage**: Per core and total
- **Memory usage**: Heap, RSS, external
- **Database connection pool**: Active connections, pool saturation
- **Cache hit rate**: Redis cache effectiveness
- **Event loop lag**: Event loop latency

## Test Execution Guide

### Pre-Test Setup

1. **Ensure backend is running:**
```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
npm install
npm start
```

2. **Database state:** Ensure database has sufficient test data:
```bash
npm run migrate
node scripts/seed-test-data.js  # Optional: create test data
```

3. **Environment variables:**
```bash
# Get or create test auth token
export AUTH_TOKEN="your_test_token"
export ADMIN_TOKEN="your_admin_token"
export BASE_URL="http://localhost:4000"
```

### Quick Start (5 minutes)

```bash
# Terminal 1: Start backend
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
npm start

# Terminal 2: Run baseline test with K6
cd /c/Users/HP/Desktop/MANAWA_NEW/backend/tests/performance
k6 run --vus 50 --duration 1m k6-load-test.js
```

### Full Test Suite (30 minutes)

```bash
# Run all three scenarios
k6 run -o json=baseline.json --vus 100 --duration 5m k6-load-test.js
k6 run -o json=peak.json --stage 30s:100 --stage 4m:1000 --stage 30s:0 k6-load-test.js
k6 run -o json=stress.json --stage 1m:1000 --stage 2m:5000 --stage 1m:0 k6-load-test.js

# Generate comparison report
node analyze-results.js baseline.json peak.json stress.json
```

## Test Scenarios

### 1. Baseline (100 VUs, 5 min)

**Purpose:** Establish normal operating performance

**Endpoints tested:**
- GET /api/health
- GET /api/projects (list)
- GET /api/professionals (list)
- GET /api/search

**Expected results:**
- p95 response time: <500ms
- Error rate: <0.1%
- Throughput: >1000 req/sec

### 2. Peak (1000 VUs, 10 min)

**Purpose:** Simulate peak traffic conditions

**Endpoints tested:**
- All baseline endpoints
- GET /api/projects/{id}
- GET /api/professionals/{id}
- POST /api/bookings
- GET /api/messages

**Expected results:**
- p95 response time: <1s
- Error rate: <1%
- Throughput: >5000 req/sec

**Ramp profile:**
- 0-30s: 0 → 100 VUs (ramp-up)
- 30s-4m30s: 100 → 1000 VUs (gradual peak)
- 4m30s-5m: 1000 → 0 VUs (ramp-down)

### 3. Stress (5000 VUs, until break)

**Purpose:** Find breaking point and system limits

**Endpoints tested:**
- All peak endpoints
- GET /api/admin/kpis
- POST /api/notifications

**Ramp profile:**
- 0-1m: 0 → 1000 VUs
- 1m-3m: 1000 → 5000 VUs
- 3m-4m: 5000 → 0 VUs

**Success criteria:**
- System remains responsive (avg p95 <3s)
- Error rate increases but remains <10%
- Database connection pool doesn't leak
- Memory doesn't grow unbounded

## Interpreting Results

### Good Performance ✅

```
p50: 150ms (50% of requests complete in 150ms)
p95: 450ms (95% of requests complete in 450ms)
p99: 800ms (99% of requests complete in 800ms)
Error rate: 0.2%
Throughput: 5000 req/sec
```

### Acceptable Performance ⚠️

```
p50: 300ms
p95: 950ms (approaching threshold)
p99: 1500ms
Error rate: 0.8%
Throughput: 3000 req/sec
```

### Poor Performance ❌

```
p50: 1000ms
p95: 3000ms (well above threshold)
p99: 5000ms
Error rate: 5%+
Throughput: <1000 req/sec
```

## Bottleneck Analysis

### Common Bottlenecks

1. **Database**
   - Indicators: High p95/p99, consistent under all loads
   - Solution: Add indexes, query optimization, connection pooling

2. **CPU**
   - Indicators: Response time increases linearly with VUs
   - Solution: Horizontal scaling, async optimization

3. **Memory**
   - Indicators: Response time increases, then crashes
   - Solution: Check for leaks, optimize heap size

4. **Network**
   - Indicators: Consistent high latency from external calls
   - Solution: Use CDN, connection pooling, caching

5. **Redis Cache**
   - Indicators: High latency, cache misses
   - Solution: Optimize TTL, increase memory, check keys

### Debugging Steps

```bash
# 1. Monitor system during test
watch -n 1 'ps aux | grep node'  # CPU, memory
vmstat 1                          # I/O, context switches
iostat 1                          # Disk I/O

# 2. Enable detailed logging
DEBUG=* npm start

# 3. Check database connections
psql -U postgres -h localhost -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Monitor Redis
redis-cli INFO stats

# 5. Check network
netstat -an | grep ESTABLISHED | wc -l
```

## Performance Optimization Recommendations

### Quick Wins (1-2 hours)
1. Enable database query caching (Redis)
2. Add missing database indexes
3. Implement HTTP caching headers
4. Use connection pooling

### Medium Effort (4-8 hours)
1. Implement response compression (gzip)
2. Optimize N+1 queries
3. Add database replication for read scaling
4. Implement CDN for static assets

### Major Changes (1-2 days)
1. Horizontal scaling (multiple instances)
2. Database sharding
3. API response pagination optimization
4. Async job queue for long operations

## Continuous Monitoring

### Post-deployment Testing

```bash
# Run baseline test weekly
0 2 * * 1 k6 run k6-load-test.js --vus 100 --duration 5m

# Run peak test monthly
0 3 1 * * k6 run k6-load-test.js --stage 30s:100 --stage 4m:1000 --stage 30s:0
```

### Alerting

Set up alerts for:
- p95 response time > 1000ms
- Error rate > 1%
- Throughput drop > 20%
- CPU usage > 85%
- Memory usage > 80%

## Files

- **k6-load-test.js** - K6 load test scenarios
- **artillery-config.yaml** - Artillery YAML configuration
- **jmeter-scenarios.jmx** - JMeter test plan
- **analyze-results.js** - Result analysis script
- **monitor.js** - System monitoring during tests
- **README.md** - This file

## Troubleshooting

### K6 Issues

**Error: "Too many open files"**
```bash
# Increase file descriptors
ulimit -n 65535
```

**Memory spike during test**
```bash
# Run with lower VUs
k6 run --vus 10 --duration 1m k6-load-test.js
```

### Artillery Issues

**Port already in use**
```bash
# Kill existing process
lsof -ti:4000 | xargs kill -9
```

**Timeout errors**
```bash
# Increase timeout in config
# Change `timeout: 30` to `timeout: 60`
```

### JMeter Issues

**GUI not starting**
```bash
# Run in headless mode instead
jmeter -n -t jmeter-scenarios.jmx -l results.jtl
```

## Support

For issues or questions:
1. Check test logs: `k6-results.json`, `artillery-results.json`, `jmeter.log`
2. Review application logs: `/c/Users/HP/Desktop/MANAWA_NEW/backend/logs/`
3. Check database performance: Use `EXPLAIN ANALYZE` on slow queries
4. Monitor server metrics: CPU, memory, I/O, network

## Additional Resources

- K6 Documentation: https://k6.io/docs/
- Artillery Documentation: https://artillery.io/docs
- JMeter Documentation: https://jmeter.apache.org/usermanual/
- Express Performance: https://expressjs.com/en/advanced/best-practice-performance.html
