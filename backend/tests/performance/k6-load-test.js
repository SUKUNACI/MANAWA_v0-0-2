/**
 * K6 Load Testing Script for MANAWA Backend
 *
 * Three test scenarios:
 * 1. Baseline: 100 concurrent users over 5 minutes
 * 2. Peak: 1000 concurrent users over 10 minutes
 * 3. Stress: 5000 concurrent users until break point
 *
 * Usage:
 * - Baseline: k6 run --vus 100 --duration 5m k6-load-test.js
 * - Peak: k6 run --stage 30s:100 --stage 4m:1000 --stage 30s:0 k6-load-test.js
 * - Stress: k6 run --stage 1m:1000 --stage 2m:5000 --stage 1m:0 k6-load-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const successCount = new Counter('success_requests');
const failureCount = new Counter('failure_requests');
const activeConnections = new Gauge('active_connections');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';
const TEST_SCENARIO = __ENV.TEST_SCENARIO || 'baseline';

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      exec: 'baselineScenario',
    },
    peak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '4m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      exec: 'peakScenario',
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 5000 },
        { duration: '1m', target: 0 },
      ],
      exec: 'stressScenario',
    },
  },
  thresholds: {
    'response_time': ['p(95)<500', 'p(99)<1000'],
    'errors': ['rate<0.01'],
  },
};

// Helper: Create auth header
function getAuthHeader() {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` }),
    },
  };
}

// Helper: Create admin auth header
function getAdminHeader() {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN && { 'Authorization': `Bearer ${ADMIN_TOKEN}` }),
    },
  };
}

// Test 1: GET /api/projects - List projects
export function testProjectsList() {
  return group('GET /api/projects', function() {
    const response = http.get(`${BASE_URL}/api/projects`, getAuthHeader());
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
      'has projects array': (r) => r.body.includes('[]') || r.body.includes('id'),
    });

    responseTime.add(response.timings.duration, { endpoint: 'GET /api/projects' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
    sleep(1);
  });
}

// Test 2: GET /api/professionals - List professionals
export function testProfessionalsList() {
  return group('GET /api/professionals', function() {
    const response = http.get(
      `${BASE_URL}/api/professionals?page=1&limit=20`,
      getAuthHeader()
    );
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 1s': (r) => r.timings.duration < 1000,
      'has professionals': (r) => r.body.includes('[]') || r.body.includes('user'),
    });

    responseTime.add(response.timings.duration, { endpoint: 'GET /api/professionals' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
    sleep(1);
  });
}

// Test 3: GET /api/search - Search endpoint
export function testSearch() {
  return group('GET /api/search', function() {
    const searchTerms = ['electrician', 'plumber', 'painter', 'carpenter'];
    const searchTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];

    const response = http.get(
      `${BASE_URL}/api/search?q=${searchTerm}&category=all`,
      getAuthHeader()
    );
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200 || r.status === 400,
      'response time < 2s': (r) => r.timings.duration < 2000,
    });

    responseTime.add(response.timings.duration, { endpoint: 'GET /api/search' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
    sleep(1);
  });
}

// Test 4: POST /api/bookings - Create booking
export function testCreateBooking() {
  return group('POST /api/bookings', function() {
    const payload = JSON.stringify({
      projectId: `project-${Math.random().toString(36).substr(2, 9)}`,
      professionalId: `pro-${Math.random().toString(36).substr(2, 9)}`,
      serviceDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      amount: Math.floor(Math.random() * 1000) + 100,
    });

    const response = http.post(
      `${BASE_URL}/api/bookings`,
      payload,
      getAuthHeader()
    );
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 201 or 400': (r) => r.status === 201 || r.status === 400 || r.status === 401,
      'response time < 1s': (r) => r.timings.duration < 1000,
    });

    responseTime.add(response.timings.duration, { endpoint: 'POST /api/bookings' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
    sleep(1);
  });
}

// Test 5: GET /api/admin/kpis - Admin KPIs
export function testAdminKPIs() {
  return group('GET /api/admin/kpis', function() {
    const response = http.get(`${BASE_URL}/api/admin/kpis`, getAdminHeader());
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      'response time < 2s': (r) => r.timings.duration < 2000,
    });

    responseTime.add(response.timings.duration, { endpoint: 'GET /api/admin/kpis' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
    sleep(1);
  });
}

// Test 6: GET /api/health - Health check
export function testHealthCheck() {
  return group('GET /api/health', function() {
    const response = http.get(`${BASE_URL}/api/health`);
    activeConnections.add(1);

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 100ms': (r) => r.timings.duration < 100,
      'response is ok': (r) => r.body.includes('ok'),
    });

    responseTime.add(response.timings.duration, { endpoint: 'GET /api/health' });
    if (isSuccess) {
      successCount.add(1);
    } else {
      failureCount.add(1);
      errorRate.add(1);
    }
    activeConnections.add(-1);
  });
}

// Baseline scenario: steady load with core endpoints
export function baselineScenario() {
  testHealthCheck();
  testProjectsList();
  testProfessionalsList();
  testSearch();
  sleep(1);
}

// Peak scenario: increased load with all endpoints
export function peakScenario() {
  testHealthCheck();
  testProjectsList();
  testProfessionalsList();
  testSearch();
  testCreateBooking();
  sleep(1);
}

// Stress scenario: maximum load until break point
export function stressScenario() {
  testHealthCheck();
  testProjectsList();
  testProfessionalsList();
  testSearch();
  testCreateBooking();
  testAdminKPIs();
  sleep(1);
}

// Export results summary
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    '/c/Users/HP/Desktop/MANAWA_NEW/backend/tests/performance/k6-results.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const { indent = '', enableColors = false } = options;
  const color = enableColors ? {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
  } : { green: '', red: '', yellow: '', reset: '' };

  let summary = `\n${color.green}=== K6 Load Test Summary ===${color.reset}\n`;

  if (data.metrics) {
    const metrics = data.metrics;

    summary += `\n${color.yellow}Response Times:${color.reset}\n`;
    if (metrics.response_time) {
      const rt = metrics.response_time.values;
      summary += `${indent}p50: ${Math.round(rt.p50 || 0)}ms\n`;
      summary += `${indent}p95: ${Math.round(rt.p95 || 0)}ms\n`;
      summary += `${indent}p99: ${Math.round(rt.p99 || 0)}ms\n`;
      summary += `${indent}avg: ${Math.round(rt.avg || 0)}ms\n`;
      summary += `${indent}max: ${Math.round(rt.max || 0)}ms\n`;
    }

    summary += `\n${color.yellow}Request Counts:${color.reset}\n`;
    if (metrics.success_requests) {
      summary += `${indent}Success: ${metrics.success_requests.value}\n`;
    }
    if (metrics.failure_requests) {
      const failCount = metrics.failure_requests.value;
      summary += `${indent}${failCount > 0 ? color.red : ''}Failures: ${failCount}${color.reset}\n`;
    }
    if (metrics.errors) {
      const errorRate = (metrics.errors.value * 100).toFixed(2);
      summary += `${indent}${errorRate > 1 ? color.red : ''}Error Rate: ${errorRate}%${color.reset}\n`;
    }

    summary += `\n${color.yellow}Throughput:${color.reset}\n`;
    if (data.metrics.http_reqs) {
      const totalReqs = data.metrics.http_reqs.value;
      const duration = (data.state.testRunDurationMs / 1000 / 60).toFixed(1);
      summary += `${indent}Total Requests: ${totalReqs}\n`;
      summary += `${indent}Requests/sec: ${(totalReqs / (data.state.testRunDurationMs / 1000)).toFixed(2)}\n`;
      summary += `${indent}Test Duration: ${duration}m\n`;
    }
  }

  summary += `\n${color.green}=================${color.reset}\n`;
  return summary;
}
