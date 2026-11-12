# Performance Testing Suite - Complete Index

**Suite Version:** 1.0  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12

---

## 📋 Quick Navigation

### Getting Started
1. **README.md** - Installation, usage, and troubleshooting
2. **PERFORMANCE_BASELINE.md** - Performance targets and metrics
3. **OPTIMIZATION_RECOMMENDATIONS.md** - Specific improvements

### Test Scripts
1. **k6-load-test.js** - Modern load testing (K6 framework)
2. **artillery-config.yaml** - Artillery YAML configuration
3. **jmeter-scenarios.jmx** - JMeter enterprise testing plan
4. **run-tests.sh** - Automated test runner script

### Utilities
1. **analyze-results.js** - Result analysis and comparison
2. **monitor.js** - System metrics collection
3. **package.json** - Dependencies (if using locally)

---

## 🚀 Quick Start (5 minutes)

### Option 1: Fastest Start with K6

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend/tests/performance

# Install K6 (if not installed)
# macOS: brew install k6
# Linux: apt-get install k6
# Windows: choco install k6

# Run baseline test
k6 run --vus 100 --duration 5m k6-load-test.js
```

### Option 2: Automated Test Suite

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend/tests/performance

# Make script executable
chmod +x run-tests.sh

# Run baseline test
./run-tests.sh baseline

# Or run all tests
./run-tests.sh all
```

### Option 3: Artillery

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend/tests/performance

# Install Artillery
npm install -g artillery

# Run test
artillery run artillery-config.yaml --target "http://localhost:4000"

# View HTML report
artillery report results.json --output report.html
```

---

## 📊 Test Scenarios Included

### Scenario 1: Baseline (100 VUs, 5 min)
- **Purpose:** Establish normal operating performance
- **Load Profile:** Constant 100 concurrent users
- **Endpoints:** All core API endpoints
- **Success Criteria:** p95 <500ms, error rate <1%

### Scenario 2: Peak Load (1000 VUs, 10 min)
- **Purpose:** Validate system under peak traffic
- **Load Profile:** Ramp from 100 → 1000 VUs
- **Endpoints:** All endpoints including writes
- **Success Criteria:** p95 <1s, error rate <1%

### Scenario 3: Stress Test (5000 VUs, 4 min)
- **Purpose:** Find breaking point
- **Load Profile:** Ramp to 5000 concurrent users
- **Endpoints:** All endpoints, maximum concurrency
- **Success Criteria:** Graceful degradation, no cascading failures

---

## 📈 Key Metrics Tracked

### Response Time Percentiles
```
p50 (Median):    50% of requests faster than this
p95 (Tail):      95% of requests faster than this
p99 (Tail):      99% of requests faster than this
avg (Average):   Mean response time
max (Maximum):   Slowest response time
```

### Request Quality
```
Success Count:   Total successful requests (2xx/3xx status)
Failure Count:   Total failed requests (4xx/5xx status)
Error Rate:      Percentage of requests that failed
HTTP Status:     Distribution of response codes
```

### System Performance
```
Throughput:      Requests per second
Connection Pool: Database connections used
Memory Usage:    System memory consumption
CPU Usage:       Processor utilization
Event Loop Lag:  Node.js event loop delay
```

---

## 🎯 Performance Thresholds

### Baseline (100 VUs)
| Metric | Target | Accept | Fail |
|--------|--------|--------|------|
| p95 Response | <300ms | <500ms | >500ms |
| p99 Response | <500ms | <1000ms | >1000ms |
| Error Rate | <0.1% | <1% | >1% |
| Throughput | >1000 req/s | >800 req/s | <800 req/s |

### Peak Load (1000 VUs)
| Metric | Target | Accept | Fail |
|--------|--------|--------|------|
| p95 Response | <500ms | <1000ms | >1000ms |
| p99 Response | <1000ms | <2000ms | >2000ms |
| Error Rate | <0.5% | <1.5% | >1.5% |
| Throughput | >5000 req/s | >3000 req/s | <3000 req/s |

### Stress (5000 VUs)
| Metric | Target | Accept | Fail |
|--------|--------|--------|------|
| p95 Response | <1000ms | <3000ms | >3000ms |
| Error Rate | <5% | <10% | >10% |
| Recovery | Full in <5m | Full in <10m | Cascading failure |

---

## 🔍 Test Endpoints

The test suite covers all major API endpoints:

### Public Endpoints (No Auth Required)
- `GET /api/health` - Health check (baseline)

### Authenticated Endpoints
- `GET /api/projects` - List projects (baseline)
- `GET /api/projects/:id` - Project details (peak)
- `GET /api/professionals` - List professionals (baseline)
- `GET /api/professionals/:id` - Professional details (peak)
- `GET /api/search?q=...` - Global search (baseline)
- `GET /api/messages` - List messages (peak)
- `GET /api/notifications` - List notifications (stress)
- `POST /api/bookings` - Create booking (peak)

### Admin Endpoints (With Admin Token)
- `GET /api/admin/kpis` - KPI dashboard (stress)

---

## 📁 File Structure

```
tests/performance/
├── README.md                          # Installation & usage guide
├── PERFORMANCE_BASELINE.md            # Baseline metrics & thresholds
├── OPTIMIZATION_RECOMMENDATIONS.md    # Improvement roadmap
├── INDEX.md                          # This file
│
├── k6-load-test.js                   # K6 test script
├── artillery-config.yaml             # Artillery configuration
├── jmeter-scenarios.jmx              # JMeter test plan
├── run-tests.sh                      # Automated test runner
│
├── analyze-results.js                # Result analyzer
├── monitor.js                        # System monitor
│
├── results/                          # Test results (generated)
│   ├── baseline_*.json
│   ├── peak_*.json
│   ├── stress_*.json
│   └── monitor_*.json
│
└── docs/                             # Additional documentation
    ├── BOTTLENECK_ANALYSIS.md
    ├── SCALING_STRATEGY.md
    └── MONITORING_SETUP.md
```

---

## 🛠️ Tool Comparison

### K6 (Recommended)
**Pros:**
- Modern, built for performance testing
- JavaScript-based, easy to learn
- Excellent metrics collection
- Cloud integration available
- Low resource overhead

**Cons:**
- Fewer features than JMeter
- Less enterprise integrations

**Best For:** Developers, CI/CD pipelines, cloud-native testing

### Artillery
**Pros:**
- YAML configuration (declarative)
- Good reporting
- Plugin ecosystem
- Easy to learn

**Cons:**
- Less powerful scripting than K6
- Higher resource overhead

**Best For:** Teams preferring declarative configs, smoke testing

### JMeter
**Pros:**
- Most powerful/flexible
- GUI for non-developers
- Enterprise features
- Extensive plugin ecosystem

**Cons:**
- High learning curve
- Resource intensive
- Slower to run

**Best For:** Enterprise, complex scenarios, GUI preference

---

## 🔧 Configuration

### Environment Variables

```bash
# Backend target
BASE_URL=http://localhost:4000

# Authentication
AUTH_TOKEN=your_user_token_here
ADMIN_TOKEN=your_admin_token_here

# Testing
TEST_SCENARIO=baseline  # baseline|peak|stress
RESULTS_DIR=./results
VERBOSE=true            # Enable detailed logging
```

### K6 Options

```bash
# Control test duration and VUs
k6 run --vus 100 --duration 5m k6-load-test.js

# Ramp up schedule
k6 run --stage 1m:100 --stage 5m:500 --stage 1m:0 k6-load-test.js

# Output options
k6 run -o json=results.json k6-load-test.js
k6 run -o cloud k6-load-test.js                    # K6 Cloud
```

---

## 📊 Interpreting Results

### Good Performance ✅

```
Baseline (100 VUs):
- p95 response time: 350ms
- p99 response time: 650ms
- Error rate: 0.2%
- Throughput: 1200 req/sec

Verdict: System performing well
```

### Acceptable Performance ⚠️

```
Peak Load (1000 VUs):
- p95 response time: 950ms
- p99 response time: 1800ms
- Error rate: 0.9%
- Throughput: 6500 req/sec

Verdict: Acceptable, monitor for improvements
```

### Poor Performance ❌

```
Peak Load (1000 VUs):
- p95 response time: 2500ms
- p99 response time: 4000ms
- Error rate: 5%+
- Throughput: 2000 req/sec

Verdict: Performance degradation detected, investigate
```

---

## 🐛 Troubleshooting

### "K6 not found"
```bash
# Install K6
brew install k6  # macOS
apt-get install k6  # Linux
choco install k6  # Windows (Chocolatey)
```

### "Backend not running"
```bash
# Start backend
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
npm start
```

### "High error rate in tests"
```bash
# Check backend logs
tail -f /c/Users/HP/Desktop/MANAWA_NEW/backend/logs/error.log

# Verify database connection
psql -U postgres -c "SELECT 1"

# Check Redis connection
redis-cli ping
```

### "Tests running too slowly"
```bash
# Reduce VUs for initial test
k6 run --vus 10 --duration 1m k6-load-test.js

# Check if backend is overloaded
ps aux | grep node
top -p $(pgrep -f "node index.js")
```

---

## 📈 Workflow

### Daily Development
```bash
# Quick smoke test (1 min)
k6 run --vus 10 --duration 1m k6-load-test.js
```

### Before Deployment
```bash
# Full baseline test
./run-tests.sh baseline

# Verify results
node analyze-results.js results/baseline_*.json
```

### Weekly Regression
```bash
# Run all scenarios
./run-tests.sh all

# Compare with previous week
node analyze-results.js \
  results/baseline_2026-11-05.json \
  results/baseline_2026-11-12.json
```

### When Performance Changes
```bash
# Run full suite
./run-tests.sh all

# Analyze differences
node analyze-results.js \
  results/baseline_current.json \
  results/baseline_previous.json

# Identify bottlenecks
# Check recommendations in OPTIMIZATION_RECOMMENDATIONS.md
```

---

## 🎓 Learning Resources

### Documentation
- [K6 Official Docs](https://k6.io/docs/)
- [Artillery Docs](https://artillery.io/docs)
- [JMeter User Guide](https://jmeter.apache.org/usermanual/)
- [Express.js Performance](https://expressjs.com/en/advanced/best-practice-performance.html)

### Articles
- Performance Testing Best Practices
- Load Testing Strategies
- Database Optimization Tips
- Node.js Performance Monitoring

### Tools
- K6 Cloud for distributed testing
- Datadog for APM
- New Relic for monitoring
- Prometheus + Grafana for metrics

---

## ✅ Pre-Test Checklist

Before running tests:

- [ ] Backend is running (`npm start`)
- [ ] Database is accessible
- [ ] Redis cache is running
- [ ] AUTH_TOKEN is set (if testing authenticated endpoints)
- [ ] ADMIN_TOKEN is set (if testing admin endpoints)
- [ ] No other load-generating processes running
- [ ] System has at least 2GB free memory
- [ ] Network is stable
- [ ] K6/Artillery/JMeter is installed

---

## 📞 Support

### Getting Help

1. **Check logs:**
   ```bash
   tail -f backend/logs/error.log
   tail -f tests/performance/jmeter.log
   ```

2. **Run with verbose output:**
   ```bash
   DEBUG=* k6 run k6-load-test.js
   ```

3. **Check system health:**
   ```bash
   # CPU and memory
   top -p $(pgrep -f "node index.js")
   
   # Database
   psql -U postgres -c "SELECT version();"
   
   # Redis
   redis-cli INFO stats
   ```

4. **Review documentation:**
   - Check README.md for common issues
   - Review OPTIMIZATION_RECOMMENDATIONS.md for bottleneck analysis
   - Check PERFORMANCE_BASELINE.md for metrics explanation

---

## 📋 Checklists

### Post-Test Analysis
- [ ] Review response time percentiles (p50, p95, p99)
- [ ] Check error rate
- [ ] Verify throughput
- [ ] Monitor resource usage (CPU, memory)
- [ ] Check database connection pool
- [ ] Review slow query logs
- [ ] Compare with baseline
- [ ] Document findings

### Performance Improvement
- [ ] Add missing database indexes
- [ ] Implement caching strategy
- [ ] Fix N+1 query problems
- [ ] Enable connection pooling
- [ ] Implement response compression
- [ ] Add rate limiting
- [ ] Set up monitoring
- [ ] Document changes

---

**Next Steps:**
1. Run baseline test: `./run-tests.sh baseline`
2. Review results in `results/` directory
3. Compare with PERFORMANCE_BASELINE.md
4. Apply recommendations from OPTIMIZATION_RECOMMENDATIONS.md
5. Retest to verify improvements

---

**Questions?** Review the detailed documentation:
- **Installation:** README.md
- **Metrics:** PERFORMANCE_BASELINE.md
- **Improvements:** OPTIMIZATION_RECOMMENDATIONS.md
