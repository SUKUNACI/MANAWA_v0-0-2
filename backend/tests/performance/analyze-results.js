#!/usr/bin/env node

/**
 * Performance Test Results Analyzer
 *
 * Usage: node analyze-results.js baseline.json peak.json stress.json
 *
 * Compares K6 test results and identifies bottlenecks
 */

const fs = require('fs');
const path = require('path');

// Color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format time
function formatTime(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

// Get color for metric based on threshold
function getMetricColor(value, thresholds) {
  if (value <= thresholds.good) return colors.green;
  if (value <= thresholds.warning) return colors.yellow;
  return colors.red;
}

// Parse K6 results
function parseK6Results(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    if (!data.metrics) {
      throw new Error('Invalid K6 results format');
    }

    const metrics = {};

    // Extract response time metrics
    if (data.metrics.response_time) {
      metrics.responseTime = {
        p50: data.metrics.response_time.values?.p50 || 0,
        p95: data.metrics.response_time.values?.p95 || 0,
        p99: data.metrics.response_time.values?.p99 || 0,
        avg: data.metrics.response_time.values?.avg || 0,
        max: data.metrics.response_time.values?.max || 0,
      };
    }

    // Extract request counts
    if (data.metrics.success_requests) {
      metrics.successRequests = data.metrics.success_requests.value || 0;
    }
    if (data.metrics.failure_requests) {
      metrics.failureRequests = data.metrics.failure_requests.value || 0;
    }
    if (data.metrics.errors) {
      metrics.errorRate = data.metrics.errors.value || 0;
    }

    // Total requests
    if (data.metrics.http_reqs) {
      metrics.totalRequests = data.metrics.http_reqs.value || 0;
    }

    // Throughput calculation
    if (data.state && data.state.testRunDurationMs) {
      metrics.duration = data.state.testRunDurationMs / 1000 / 60; // minutes
      if (metrics.totalRequests && data.state.testRunDurationMs) {
        metrics.throughput = (metrics.totalRequests / (data.state.testRunDurationMs / 1000)).toFixed(2);
      }
    }

    return metrics;
  } catch (err) {
    console.error(`Error parsing ${filePath}: ${err.message}`);
    return null;
  }
}

// Compare two result sets
function compareResults(scenario1Name, scenario1, scenario2Name, scenario2) {
  console.log(`\n${colors.bold}${colors.cyan}Comparison: ${scenario1Name} vs ${scenario2Name}${colors.reset}\n`);

  if (!scenario1 || !scenario2) {
    console.log('Insufficient data for comparison');
    return;
  }

  const comparisons = [
    {
      metric: 'p95 Response Time',
      value1: scenario1.responseTime?.p95,
      value2: scenario2.responseTime?.p95,
      unit: 'ms',
      thresholds: { good: 500, warning: 1000 },
      format: (v) => v.toFixed(0),
    },
    {
      metric: 'p99 Response Time',
      value1: scenario1.responseTime?.p99,
      value2: scenario2.responseTime?.p99,
      unit: 'ms',
      thresholds: { good: 1000, warning: 2000 },
      format: (v) => v.toFixed(0),
    },
    {
      metric: 'Error Rate',
      value1: scenario1.errorRate * 100,
      value2: scenario2.errorRate * 100,
      unit: '%',
      thresholds: { good: 0.1, warning: 1 },
      format: (v) => v.toFixed(2),
    },
    {
      metric: 'Throughput',
      value1: scenario1.throughput,
      value2: scenario2.throughput,
      unit: 'req/sec',
      thresholds: { good: 1000, warning: 100 },
      format: (v) => v.toString(),
    },
  ];

  for (const comp of comparisons) {
    if (comp.value1 === undefined || comp.value2 === undefined) continue;

    const change = comp.value2 - comp.value1;
    const changePercent = ((change / comp.value1) * 100).toFixed(1);
    const changeStr = change > 0 ? `+${changePercent}%` : `${changePercent}%`;

    const color = change > 0 ? colors.red : colors.green;

    console.log(`  ${comp.metric}:`);
    console.log(`    ${scenario1Name}: ${comp.format(comp.value1)} ${comp.unit}`);
    console.log(`    ${scenario2Name}: ${color}${comp.format(comp.value2)} ${comp.unit} (${changeStr})${colors.reset}`);
  }
}

// Identify bottlenecks
function identifyBottlenecks(results) {
  console.log(`\n${colors.bold}${colors.yellow}Bottleneck Analysis${colors.reset}\n`);

  const issues = [];

  for (const [scenario, metrics] of Object.entries(results)) {
    if (!metrics) continue;

    // Check response times
    if (metrics.responseTime?.p95 > 1000) {
      issues.push({
        severity: 'high',
        scenario,
        issue: `p95 Response Time (${metrics.responseTime.p95.toFixed(0)}ms) exceeds 1000ms threshold`,
        recommendation: 'Optimize database queries, add caching, or scale horizontally',
      });
    }

    if (metrics.responseTime?.p99 > 2000) {
      issues.push({
        severity: 'high',
        scenario,
        issue: `p99 Response Time (${metrics.responseTime.p99.toFixed(0)}ms) exceeds 2000ms threshold`,
        recommendation: 'Investigate tail latency, check for network issues or GC pauses',
      });
    }

    // Check error rates
    if (metrics.errorRate > 0.01) {
      issues.push({
        severity: 'high',
        scenario,
        issue: `Error Rate (${(metrics.errorRate * 100).toFixed(2)}%) exceeds 1% threshold`,
        recommendation: 'Check application logs for errors, verify database connectivity',
      });
    }

    // Check throughput degradation
    if (metrics.throughput < 100) {
      issues.push({
        severity: 'medium',
        scenario,
        issue: `Low throughput (${metrics.throughput} req/sec) detected`,
        recommendation: 'Check for connection pool exhaustion or slow requests',
      });
    }
  }

  if (issues.length === 0) {
    console.log(`${colors.green}✓ No significant bottlenecks detected${colors.reset}\n`);
    return;
  }

  // Sort by severity
  issues.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  for (const issue of issues) {
    const color = issue.severity === 'high' ? colors.red : colors.yellow;
    console.log(`  ${color}[${issue.severity.toUpperCase()}]${colors.reset} ${issue.scenario}`);
    console.log(`    Issue: ${issue.issue}`);
    console.log(`    → ${issue.recommendation}\n`);
  }
}

// Generate report
function generateReport(results) {
  console.log(`\n${colors.bold}${colors.cyan}Performance Test Report${colors.reset}\n`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  for (const [scenario, metrics] of Object.entries(results)) {
    if (!metrics) {
      console.log(`${colors.red}✗ ${scenario}: Invalid data${colors.reset}\n`);
      continue;
    }

    console.log(`${colors.bold}${scenario.toUpperCase()}${colors.reset}`);
    console.log('─'.repeat(50));

    // Response times
    const p95Color = getMetricColor(metrics.responseTime?.p95, { good: 500, warning: 1000 });
    const p99Color = getMetricColor(metrics.responseTime?.p99, { good: 1000, warning: 2000 });
    const errorColor = getMetricColor(metrics.errorRate * 100, { good: 0.1, warning: 1 });

    console.log('Response Times:');
    console.log(`  p50: ${formatTime(metrics.responseTime?.p50)}`);
    console.log(`  p95: ${p95Color}${formatTime(metrics.responseTime?.p95)}${colors.reset}`);
    console.log(`  p99: ${p99Color}${formatTime(metrics.responseTime?.p99)}${colors.reset}`);
    console.log(`  avg: ${formatTime(metrics.responseTime?.avg)}`);
    console.log(`  max: ${formatTime(metrics.responseTime?.max)}`);

    console.log('\nRequest Stats:');
    console.log(`  Total Requests: ${metrics.totalRequests}`);
    console.log(`  Successful: ${metrics.successRequests}`);
    console.log(`  Failed: ${colors.red}${metrics.failureRequests}${colors.reset}`);
    console.log(`  Error Rate: ${errorColor}${(metrics.errorRate * 100).toFixed(2)}%${colors.reset}`);
    console.log(`  Throughput: ${metrics.throughput} req/sec`);
    console.log(`  Duration: ${metrics.duration?.toFixed(1)} min`);

    console.log('\n');
  }
}

// Main
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node analyze-results.js <baseline.json> [peak.json] [stress.json]');
    console.log('\nExample: node analyze-results.js baseline.json peak.json stress.json');
    process.exit(1);
  }

  const results = {};

  // Parse each results file
  for (const filePath of args) {
    const scenario = path.basename(filePath, '.json');
    results[scenario] = parseK6Results(filePath);
  }

  // Generate report
  generateReport(results);

  // Identify bottlenecks
  identifyBottlenecks(results);

  // Compare scenarios
  if (args.length >= 2) {
    const baselineKey = Object.keys(results)[0];
    const peakKey = Object.keys(results).length > 1 ? Object.keys(results)[1] : null;

    if (peakKey) {
      compareResults(baselineKey, results[baselineKey], peakKey, results[peakKey]);
    }

    if (Object.keys(results).length > 2) {
      const stressKey = Object.keys(results)[2];
      compareResults(peakKey, results[peakKey], stressKey, results[stressKey]);
    }
  }

  // Summary
  console.log(`\n${colors.bold}${colors.cyan}Recommendations${colors.reset}\n`);

  const baseline = results.baseline;
  const peak = Object.values(results)[1];
  const stress = Object.values(results)[2];

  if (baseline && peak) {
    const p95Increase = ((peak.responseTime?.p95 - baseline.responseTime?.p95) / baseline.responseTime?.p95 * 100).toFixed(1);

    if (p95Increase > 50) {
      console.log(`${colors.red}✗ Response time degradation detected (${p95Increase}% increase from baseline to peak)${colors.reset}`);
      console.log('  Recommendations:');
      console.log('  1. Add database indexes for frequently queried fields');
      console.log('  2. Implement Redis caching for read-heavy endpoints');
      console.log('  3. Use connection pooling for database connections');
      console.log('  4. Consider horizontal scaling with load balancing\n');
    } else {
      console.log(`${colors.green}✓ Response time scale-up is acceptable (${p95Increase}% increase)${colors.reset}\n`);
    }
  }

  if (peak && stress) {
    const errorIncrease = stress.errorRate * 100 - peak.errorRate * 100;

    if (errorIncrease > 2) {
      console.log(`${colors.red}✗ Error rate spike under stress test (+${errorIncrease.toFixed(2)}%)${colors.reset}`);
      console.log('  Recommendations:');
      console.log('  1. Implement circuit breakers for external service calls');
      console.log('  2. Add request validation and rate limiting');
      console.log('  3. Implement graceful degradation');
      console.log('  4. Scale database connection pool\n');
    }
  }

  console.log(`${colors.green}✓ Analysis complete${colors.reset}\n`);
}

main();
