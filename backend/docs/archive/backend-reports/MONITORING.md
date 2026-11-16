# MANAWA Backend Monitoring & Alerting System

## Overview

The MANAWA backend now includes a comprehensive monitoring and alerting system that tracks:
- API performance (latency, request rates, error rates)
- Database health and performance
- Business metrics (payments, bookings, conversions)
- System resources (memory, CPU, uptime)
- Real-time alerts with configurable thresholds

## Architecture

### Core Components

1. **`utils/monitoring.js`** - Metrics collection engine
   - Records all request/response metrics
   - Tracks business operations (payments, bookings, quotes)
   - Manages alert triggers and notifications
   - Exports metrics in Prometheus format

2. **`routes/monitoring.js`** - REST API endpoints
   - Health checks
   - Metrics export (Prometheus format)
   - Admin monitoring dashboard
   - Alert configuration

3. **`middleware/monitoring-middleware.js`** - Express middleware
   - Intercepts HTTP requests/responses
   - Records timing and status codes
   - Tracks database operations
   - Integrates with monitoring system

## Installation

### 1. Update index.js

Add monitoring middleware early in the stack:

```javascript
// After other middleware, before routes
const { monitoringMiddleware } = require('./middleware/monitoring-middleware');
app.use(monitoringMiddleware);

// Register monitoring routes
const monitoringRoutes = require('./routes/monitoring');
app.use('/api/monitoring', monitoringRoutes);
```

### 2. Environment Variables

Add to `.env`:

```bash
# Alert destinations (optional)
ALERT_EMAIL=admin@manawa.com
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 3. Install Dependencies

All dependencies are already in `package.json`:
- `axios` - For HTTP requests
- `node-mailjet` - Email alerts
- Already have express, pino, etc.

## Endpoints

### Public Endpoints

#### `GET /api/monitoring/health`
Simple health check endpoint
- Rate limited: 200/minute
- Returns: API and database health status
- HTTP Status: 200 (healthy), 503 (unhealthy)

```bash
curl http://localhost:4000/api/monitoring/health
```

Response:
```json
{
  "status": "healthy",
  "services": {
    "api": "healthy",
    "database": "healthy"
  },
  "uptime": "0.05 hours",
  "memory": {
    "heapUsed": "45.23 MB",
    "heapTotal": "256.12 MB"
  },
  "timestamp": "2026-11-11T14:30:00.000Z"
}
```

#### `GET /api/monitoring/metrics`
Prometheus-compatible metrics endpoint
- Rate limited: 100/minute
- Returns: Metrics in Prometheus text format
- Perfect for scraping with Prometheus/Grafana

```bash
curl http://localhost:4000/api/monitoring/metrics
```

Returns Prometheus format metrics for:
- HTTP requests (total, duration, status codes)
- Errors (total, rate)
- Database operations (queries, errors)
- Business metrics (payments, bookings, users)
- System resources (memory, CPU, uptime)

### Admin Endpoints (JWT Required)

All admin endpoints require a valid JWT token with `role: 'ADMIN'`:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:4000/api/monitoring/admin/monitoring
```

#### `GET /api/monitoring/admin/monitoring`
Comprehensive monitoring dashboard data
- Rate limited: 60/minute
- Returns: Detailed metrics for dashboard

Response includes:
- System health summary
- Performance metrics (requests, errors, latency)
- Resource usage (memory, CPU)
- Business metrics (payments, bookings, active users)
- Top routes and recent errors
- Active alerts

#### `GET /api/monitoring/admin/alerts`
Get current active alerts
- Returns array of active alerts with timestamps

#### `GET /api/monitoring/admin/alerts/config`
Get current alert threshold configuration
- Returns all configurable thresholds

#### `POST /api/monitoring/admin/alerts/config`
Configure alert thresholds

Request body:
```json
{
  "errorRate": 5,
  "apiResponseTime": 2000,
  "dbConnectionPoolUsage": 80,
  "paymentFailureRate": 10,
  "queueDepth": 1000,
  "memoryUsage": 80,
  "cpuUsage": 90
}
```

#### `GET /api/monitoring/admin/performance/top-routes`
Get top performing and worst performing routes

#### `GET /api/monitoring/admin/performance/database`
Get database performance metrics

#### `GET /api/monitoring/admin/business/metrics`
Get business KPIs

#### `POST /api/monitoring/admin/monitoring/reset`
Reset daily business metrics

## Alert System

### Default Alert Thresholds

| Alert | Threshold | Description |
|-------|-----------|-------------|
| Error Rate | 5% | Alert when error rate exceeds 5% |
| API Response Time | 2000ms | Alert when any route exceeds 2 seconds |
| Payment Failures | 10/hour | Alert when payment failures spike |
| DB Connection Pool | 80% | Alert when database connections at capacity |
| Memory Usage | 80% | System memory usage alert |
| CPU Usage | 90% | System CPU usage alert |
| Queue Depth | 1000 jobs | Background job queue depth |

### Alert Types

1. **HIGH_API_LATENCY**
   - Triggered when a single request exceeds `apiResponseTime` threshold
   - Data: route, response time, method, status code

2. **HIGH_ERROR_RATE**
   - Triggered when overall error rate exceeds threshold
   - Data: error rate percentage, error count, request count

3. **HIGH_PAYMENT_FAILURE_RATE**
   - Triggered when payment failures spike
   - Data: failed count, total count, failure rate

4. **DATABASE_ERROR**
   - Triggered when database operations fail
   - Data: error count, operation count, error rate

### Alert Destinations

Alerts are sent to:

1. **Email** (if `ALERT_EMAIL` configured)
   - Via Mailjet
   - HTML formatted with alert details

2. **Slack** (if `SLACK_WEBHOOK_URL` configured)
   - Formatted message with color coding
   - Red for critical, yellow for warning

3. **Logs** (always)
   - Written to `logs/app.log` and `logs/error.log`
   - Searchable JSON format

### Alert Deduplication

- Duplicate alerts within 5 minutes are suppressed
- Prevents alert spam
- Each alert type tracked independently

## Metrics Collection

### Request Metrics

- Total requests
- Requests by HTTP method (GET, POST, PUT, DELETE, etc.)
- Requests by route
- Requests by status code
- Average response time
- Response time distribution (min, max, avg per route)

### Error Metrics

- Total errors
- Errors by type (CLIENT_ERROR, SERVER_ERROR)
- Errors by route
- Error rate percentage

### Database Metrics

- Total queries executed
- Failed queries
- Error rate

### Business Metrics (Daily)

- Payments processed (count and amount)
- Payments failed
- Bookings created
- Active users this hour
- Quotes generated
- Conversions

### System Metrics

- Uptime (hours)
- Memory usage (heap, RSS, external)
- System memory percentage
- CPU usage (user, system time)

## Integration Guide

### Recording Payment Operations

In your payment route handlers:

```javascript
const { recordPaymentMetrics } = require('../middleware/monitoring-middleware');

// After successful payment
recordPaymentMetrics(amount, 'succeeded');

// After failed payment
recordPaymentMetrics(amount, 'failed');
```

### Recording Booking Operations

In your booking route handlers:

```javascript
const { recordBookingMetrics } = require('../middleware/monitoring-middleware');

// After creating a booking
recordBookingMetrics();
```

### Recording Active Users

In your authentication or messaging handlers:

```javascript
const { recordActiveUserMetrics } = require('../middleware/monitoring-middleware');

// Track user activity
recordActiveUserMetrics(userId);
```

### Recording Database Operations

In custom database queries:

```javascript
const { recordDatabaseMetrics } = require('../middleware/monitoring-middleware');

const startTime = Date.now();
try {
  const result = await customQuery();
  recordDatabaseMetrics(true, Date.now() - startTime, 'custom_query');
} catch (err) {
  recordDatabaseMetrics(false, Date.now() - startTime, 'custom_query');
}
```

## Dashboard Setup

### Prometheus Integration

Configure Prometheus to scrape metrics:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'manawa-backend'
    static_configs:
      - targets: ['localhost:4000']
    metrics_path: '/api/monitoring/metrics'
    scrape_interval: 15s
```

### Grafana Integration

1. Add Prometheus data source
2. Create dashboard with panels:

#### Panel 1: Request Rate
```
rate(manawa_http_requests_total[5m])
```

#### Panel 2: Error Rate
```
manawa_error_rate_percent
```

#### Panel 3: Response Time (99th percentile)
```
histogram_quantile(0.99, manawa_http_request_duration_seconds)
```

#### Panel 4: Active Users
```
manawa_active_users_current
```

#### Panel 5: Payment Metrics
```
manawa_payments_processed_total
manawa_payments_failed_total
```

#### Panel 6: Memory Usage
```
manawa_memory_system_percent
```

#### Panel 7: Database Performance
```
rate(manawa_db_queries_total[5m])
```

## Logging

Logs are stored in:
- `logs/app.log` - All application logs
- `logs/error.log` - Errors only

Each log entry is JSON formatted:
```json
{
  "timestamp": "2026-11-11T14:30:00.000Z",
  "level": "INFO|WARN|ERROR|DEBUG",
  "message": "Human readable message",
  "additionalFields": "..."
}
```

## Performance Considerations

### Memory Management

- Metrics are stored in memory
- Active user tracking uses Set (auto-deduplicates)
- Alert deduplication window: 5 minutes
- Daily metrics reset at midnight (configurable)

### CPU Impact

- Monitoring middleware is lightweight
- No blocking operations in hot paths
- Alert notifications are async
- Database queries are async

### Recommendations

1. **Development**: Alerts to logs only
2. **Staging**: Alerts to logs + Slack
3. **Production**: Alerts to logs + Email + Slack

## Troubleshooting

### Alerts Not Sending

1. Check email/Slack configuration in `.env`
2. Verify network connectivity
3. Check logs for error messages
4. Ensure admin email is valid

### High Memory Usage

1. Check `logs/app.log` for memory growth patterns
2. Verify active user tracking is cleaning up properly
3. Look for response time histogram accumulation
4. Consider resetting daily metrics more frequently

### Metrics Not Available

1. Verify middleware is registered before routes
2. Check `/api/monitoring/health` returns 200
3. Ensure JWT token is valid for admin endpoints
4. Check logs for errors

## Security

- Health check endpoint is public (rate limited)
- Metrics endpoint is public (rate limited)
- All admin endpoints require valid JWT with ADMIN role
- All requests logged with timestamp
- No sensitive data in metrics output

## Next Steps

1. Deploy changes to production
2. Configure email and Slack webhooks
3. Set up Prometheus scraping
4. Create Grafana dashboards
5. Test alert notifications
6. Fine-tune thresholds based on production baseline

## API Reference

See `routes/monitoring.js` for complete endpoint documentation with examples.
