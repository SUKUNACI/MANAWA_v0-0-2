# MANAWA Monitoring Dashboard Setup

## Quick Start

The monitoring system includes a ready-to-use API endpoint for dashboard data:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:4000/api/monitoring/admin/monitoring
```

## Admin Dashboard Implementation

### 1. Basic HTML Dashboard

Create `public/admin/monitoring.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MANAWA Monitoring Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f7fa;
      color: #333;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .status { display: flex; gap: 20px; margin-top: 15px; }
    .status-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 15px;
      background: #f0f0f0;
      border-radius: 6px;
    }
    .status-badge {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-badge.healthy { background: #22c55e; }
    .status-badge.degraded { background: #eab308; }
    .status-badge.unhealthy { background: #ef4444; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card h2 { font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; }
    .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .metric:last-child { border-bottom: none; }
    .metric-label { font-weight: 500; }
    .metric-value {
      font-size: 16px;
      font-weight: bold;
      color: #0066cc;
    }

    .alert-box {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 15px;
    }
    .alert-box.warning {
      background: #fffbeb;
      border-left-color: #f59e0b;
    }

    .chart-container { height: 300px; margin: 20px 0; }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 15px;
    }
    button {
      padding: 8px 16px;
      background: #0066cc;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { background: #0052a3; }
    button.secondary {
      background: #6b7280;
    }
    button.secondary:hover {
      background: #4b5563;
    }

    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table th, .table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    .table th { background: #f9fafb; font-weight: 600; }
    .table tr:hover { background: #f9fafb; }

    .loading {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .refresh-indicator {
      font-size: 12px;
      color: #999;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 MANAWA Monitoring Dashboard</h1>
      <div class="status">
        <div class="status-item">
          <span class="status-badge healthy" id="statusBadge"></span>
          <span id="statusText">Loading...</span>
        </div>
        <div class="status-item">
          Uptime: <strong id="uptime">--</strong>
        </div>
        <div class="status-item">
          Last Updated: <strong id="lastUpdate">--</strong>
        </div>
      </div>
    </header>

    <div class="grid">
      <!-- Performance Card -->
      <div class="card">
        <h2>⚡ Performance</h2>
        <div class="metric">
          <span class="metric-label">Total Requests</span>
          <span class="metric-value" id="totalRequests">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Avg Response Time</span>
          <span class="metric-value" id="avgResponseTime">0ms</span>
        </div>
        <div class="metric">
          <span class="metric-label">Requests/Second</span>
          <span class="metric-value" id="requestsPerSec">0</span>
        </div>
      </div>

      <!-- Errors Card -->
      <div class="card">
        <h2>⚠️ Errors</h2>
        <div class="metric">
          <span class="metric-label">Total Errors</span>
          <span class="metric-value" id="totalErrors">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Error Rate</span>
          <span class="metric-value" id="errorRate">0%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Top Error Type</span>
          <span class="metric-value" id="topErrorType">None</span>
        </div>
      </div>

      <!-- Resources Card -->
      <div class="card">
        <h2>💾 Resources</h2>
        <div class="metric">
          <span class="metric-label">Memory (Heap)</span>
          <span class="metric-value" id="memoryHeap">0MB</span>
        </div>
        <div class="metric">
          <span class="metric-label">System Memory</span>
          <span class="metric-value" id="systemMemory">0%</span>
        </div>
        <div class="metric">
          <span class="metric-label">CPU Usage</span>
          <span class="metric-value" id="cpuUsage">0ms</span>
        </div>
      </div>

      <!-- Business Metrics Card -->
      <div class="card">
        <h2>💰 Business</h2>
        <div class="metric">
          <span class="metric-label">Payments Today</span>
          <span class="metric-value" id="paymentsProcessed">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Bookings Today</span>
          <span class="metric-value" id="bookingsToday">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Active Users</span>
          <span class="metric-value" id="activeUsers">0</span>
        </div>
      </div>

      <!-- Database Card -->
      <div class="card">
        <h2>🗄️ Database</h2>
        <div class="metric">
          <span class="metric-label">Status</span>
          <span class="metric-value" id="dbStatus">--</span>
        </div>
        <div class="metric">
          <span class="metric-label">Total Queries</span>
          <span class="metric-value" id="dbQueries">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Error Rate</span>
          <span class="metric-value" id="dbErrorRate">0%</span>
        </div>
      </div>

      <!-- Alerts Card -->
      <div class="card">
        <h2>🔔 Alerts</h2>
        <div id="alertsContainer">
          <p style="color: #999;">No active alerts</p>
        </div>
      </div>
    </div>

    <!-- Alerts Section -->
    <div class="card">
      <h2>📋 Recent Alerts</h2>
      <div id="recentAlerts"></div>
    </div>

    <!-- Top Routes Table -->
    <div class="card">
      <h2>🛣️ Top Routes by Latency</h2>
      <table class="table" id="topRoutesTable">
        <thead>
          <tr>
            <th>Route</th>
            <th>Requests</th>
            <th>Avg Time</th>
            <th>Max Time</th>
            <th>Min Time</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="refresh-indicator">
      <button class="secondary" onclick="refreshDashboard()">🔄 Refresh Now</button>
      <span id="autoRefreshText"> • Auto-refreshing every 30 seconds</span>
    </div>
  </div>

  <script>
    const token = localStorage.getItem('adminToken');

    async function fetchDashboardData() {
      try {
        const response = await fetch('/api/monitoring/admin/monitoring', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch');
        return await response.json();
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        return null;
      }
    }

    function updateDashboard(data) {
      if (!data) {
        document.getElementById('statusText').textContent = 'Error loading data';
        return;
      }

      // Status
      const statusBadge = document.getElementById('statusBadge');
      statusBadge.className = `status-badge ${data.summary.status}`;
      document.getElementById('statusText').textContent = data.summary.status.toUpperCase();
      document.getElementById('uptime').textContent = data.summary.uptime;

      // Performance
      document.getElementById('totalRequests').textContent = data.performance.requests.total;
      document.getElementById('avgResponseTime').textContent = data.performance.requests.avgResponseTime + 'ms';
      document.getElementById('requestsPerSec').textContent = data.performance.requests.perSecond;

      // Errors
      document.getElementById('totalErrors').textContent = data.performance.errors.total;
      document.getElementById('errorRate').textContent = data.performance.errors.rate;
      const topError = Object.keys(data.performance.errors.topTypes)[0] || 'None';
      document.getElementById('topErrorType').textContent = topError;

      // Resources
      document.getElementById('memoryHeap').textContent = data.resources.memory.heapUsed;
      document.getElementById('systemMemory').textContent = data.resources.memory.systemPercent;
      document.getElementById('cpuUsage').textContent = data.resources.cpu.user;

      // Business
      document.getElementById('paymentsProcessed').textContent = data.business.payments.processed;
      document.getElementById('bookingsToday').textContent = data.business.bookings;
      document.getElementById('activeUsers').textContent = data.business.activeUsers;

      // Database
      document.getElementById('dbStatus').textContent = data.health.database;
      document.getElementById('dbQueries').textContent = data.performance.requests.total;
      document.getElementById('dbErrorRate').textContent = data.performance.errors.rate;

      // Alerts
      const alertsContainer = document.getElementById('alertsContainer');
      if (data.alerts.active.length === 0) {
        alertsContainer.innerHTML = '<p style="color: #22c55e;">✓ All systems normal</p>';
      } else {
        alertsContainer.innerHTML = data.alerts.active.map(alert =>
          `<div class="alert-box">
            <strong>${alert.alertType}</strong>
            <pre style="font-size: 12px; margin-top: 5px; white-space: pre-wrap;">${JSON.stringify(alert.alertData, null, 2)}</pre>
          </div>`
        ).join('');
      }

      // Top Routes
      const tbody = document.querySelector('#topRoutesTable tbody');
      tbody.innerHTML = Object.entries(data.topRoutes).map(([route, metrics]) =>
        `<tr>
          <td>${route}</td>
          <td>${metrics.count}</td>
          <td>${metrics.avgTime}ms</td>
          <td>${metrics.maxTime}ms</td>
          <td>${metrics.minTime}ms</td>
        </tr>`
      ).join('');

      // Last Updated
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
    }

    async function refreshDashboard() {
      const data = await fetchDashboardData();
      updateDashboard(data);
    }

    // Initial load
    refreshDashboard();

    // Auto-refresh every 30 seconds
    setInterval(refreshDashboard, 30 * 1000);
  </script>
</body>
</html>
```

## 2. Grafana Dashboard (JSON)

Save as `config/grafana-dashboard.json`:

```json
{
  "dashboard": {
    "title": "MANAWA Backend Monitoring",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(manawa_http_requests_total[5m])"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "manawa_error_rate_percent"
          }
        ],
        "type": "gauge"
      },
      {
        "title": "Response Time P99",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, manawa_http_request_duration_seconds)"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Active Users",
        "targets": [
          {
            "expr": "manawa_active_users_current"
          }
        ],
        "type": "stat"
      },
      {
        "title": "Payments Today",
        "targets": [
          {
            "expr": "manawa_payments_processed_total"
          }
        ],
        "type": "stat"
      },
      {
        "title": "Memory Usage",
        "targets": [
          {
            "expr": "manawa_memory_system_percent"
          }
        ],
        "type": "gauge"
      },
      {
        "title": "Database Query Rate",
        "targets": [
          {
            "expr": "rate(manawa_db_queries_total[5m])"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Database Errors",
        "targets": [
          {
            "expr": "rate(manawa_db_errors_total[5m])"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

## 3. Docker Compose Stack

For complete monitoring setup:

```yaml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"
    depends_on:
      - prometheus

  alertmanager:
    image: prom/alertmanager
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
    ports:
      - "9093:9093"
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'

volumes:
  prometheus_data:
  grafana_data:
```

## 4. Prometheus Configuration

`prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

rule_files:
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'manawa-backend'
    static_configs:
      - targets: ['localhost:4000']
    metrics_path: '/api/monitoring/metrics'
    scrape_interval: 15s
```

## Access Dashboard

After deployment:

1. **Simple HTML Dashboard**: `http://localhost:4000/admin/monitoring.html`
2. **Grafana Dashboard**: `http://localhost:3000`
3. **Prometheus**: `http://localhost:9090`
4. **Alertmanager**: `http://localhost:9093`

## Dashboard Features

✓ Real-time metrics
✓ System health overview
✓ Performance analytics
✓ Error tracking
✓ Business KPIs
✓ Resource monitoring
✓ Alert management
✓ Auto-refresh (30 seconds)
✓ Responsive design
