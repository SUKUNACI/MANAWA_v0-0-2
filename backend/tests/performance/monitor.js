#!/usr/bin/env node

/**
 * System Performance Monitor
 *
 * Monitors CPU, memory, and database metrics during load tests
 *
 * Usage: node monitor.js --duration 5m --interval 5s
 */

const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);

// Parse arguments
const args = process.argv.slice(2);
const duration = parseInt(args[args.indexOf('--duration')?.toString()?.split(':')[0] + 1] || '300') * 1000;
const interval = parseInt(args[args.indexOf('--interval')?.toString()?.split(':')[0] + 1] || '5') * 1000;
const outputFile = args[args.indexOf('--output') + 1] || './monitor-results.json';

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Get CPU usage
function getCPUUsage() {
  const cpus = os.cpus();
  const usage = cpus.map((cpu, idx) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    const used = total - idle;
    return {
      cpu: idx,
      usage: Math.round((used / total) * 10000) / 100,
    };
  });

  const avgUsage = usage.reduce((a, b) => a + b.usage, 0) / usage.length;

  return {
    average: parseFloat(avgUsage.toFixed(2)),
    perCore: usage,
  };
}

// Get memory usage
function getMemoryUsage() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    total: totalMem,
    used: usedMem,
    free: freeMem,
    usagePercent: Math.round((usedMem / totalMem) * 10000) / 100,
  };
}

// Get process memory usage
async function getProcessMemoryUsage() {
  try {
    const { stdout } = await execAsync('ps aux | grep "node" | grep -v grep');
    const lines = stdout.split('\n').filter(l => l.trim());

    if (lines.length === 0) return null;

    const processes = lines.map(line => {
      const cols = line.split(/\s+/);
      return {
        pid: cols[1],
        cpu: parseFloat(cols[2]),
        memory: parseFloat(cols[3]),
        command: cols.slice(10).join(' '),
      };
    });

    return {
      total: processes.reduce((a, b) => a + b.memory, 0),
      processes: processes.slice(0, 5), // Top 5 processes
    };
  } catch {
    return null;
  }
}

// Get disk I/O
async function getDiskIO() {
  try {
    const { stdout } = await execAsync('iostat -dx 1 2 | tail -1');
    const cols = stdout.split(/\s+/).filter(c => c);
    return {
      device: cols[0],
      readKBs: parseFloat(cols[cols.length - 2]),
      writeKBs: parseFloat(cols[cols.length - 1]),
    };
  } catch {
    return null;
  }
}

// Get network stats
async function getNetworkStats() {
  try {
    const { stdout } = await execAsync('netstat -an | grep ESTABLISHED | wc -l');
    return {
      establishedConnections: parseInt(stdout.trim()),
    };
  } catch {
    return null;
  }
}

// Get database connection pool status
async function getDBConnectionPool() {
  try {
    // Check for active database connections
    // This assumes PostgreSQL is running locally
    const { stdout } = await execAsync(
      'psql -U postgres -h localhost -d postgres -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "0"'
    );
    return {
      activeConnections: parseInt(stdout.trim()) || 0,
    };
  } catch {
    return { activeConnections: 0 };
  }
}

// Format metric for display
function formatMetric(name, value, unit = '', threshold = null) {
  let color = colors.reset;

  if (threshold) {
    if (value > threshold.critical) color = colors.red;
    else if (value > threshold.warning) color = colors.yellow;
    else color = colors.green;
  }

  return `  ${name}: ${color}${value}${colors.reset} ${unit}`;
}

// Main monitoring loop
async function monitor() {
  console.log(`${colors.bold}${colors.cyan}System Performance Monitor${colors.reset}\n`);
  console.log(`Duration: ${(duration / 1000 / 60).toFixed(1)}m`);
  console.log(`Interval: ${(interval / 1000).toFixed(1)}s`);
  console.log(`Output: ${outputFile}\n`);

  const metrics = [];
  const startTime = Date.now();

  // Create header
  console.log(
    '┌─ TIME ──┬─ CPU % ─┬─ MEM % ─┬─ DISK I/O ─┬─ CONNECTIONS ─┐'
  );

  const monitorInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    const elapsedSec = Math.round(elapsed / 1000);

    // Collect metrics
    const timestamp = new Date().toISOString();
    const cpu = getCPUUsage();
    const memory = getMemoryUsage();
    const processMemory = await getProcessMemoryUsage();
    const diskIO = await getDiskIO();
    const network = await getNetworkStats();
    const dbPool = await getDBConnectionPool();

    const metric = {
      timestamp,
      elapsedSeconds: elapsedSec,
      cpu,
      memory,
      processMemory,
      diskIO,
      network,
      dbPool,
    };

    metrics.push(metric);

    // Display
    const timeStr = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`.padEnd(8);
    const cpuStr = cpu.average.toFixed(1).padEnd(7);
    const memStr = memory.usagePercent.toFixed(1).padEnd(7);
    const diskStr = (diskIO?.readKBs || 0).toFixed(0).padEnd(10);
    const connStr = (network?.establishedConnections || 0).toString().padEnd(13);

    // Color coding
    let cpuColor = colors.reset;
    if (cpu.average > 85) cpuColor = colors.red;
    else if (cpu.average > 70) cpuColor = colors.yellow;
    else cpuColor = colors.green;

    let memColor = colors.reset;
    if (memory.usagePercent > 85) memColor = colors.red;
    else if (memory.usagePercent > 70) memColor = colors.yellow;
    else memColor = colors.green;

    console.log(
      `│ ${timeStr} │ ${cpuColor}${cpuStr}${colors.reset} │ ${memColor}${memStr}${colors.reset} │ ${diskStr} │ ${connStr} │`
    );

    // Check if done
    if (elapsed >= duration) {
      clearInterval(monitorInterval);
      finalize(metrics);
    }
  }, interval);
}

// Save and finalize
function finalize(metrics) {
  console.log(
    '└────────┴─────────┴─────────┴────────────┴───────────────┘\n'
  );

  // Calculate averages
  const avgCPU = metrics.reduce((a, b) => a + b.cpu.average, 0) / metrics.length;
  const avgMemory = metrics.reduce((a, b) => a + b.memory.usagePercent, 0) / metrics.length;
  const maxCPU = Math.max(...metrics.map(m => m.cpu.average));
  const maxMemory = Math.max(...metrics.map(m => m.memory.usagePercent));
  const maxConnections = Math.max(...metrics.map(m => m.network?.establishedConnections || 0));

  console.log(`${colors.bold}Summary${colors.reset}\n`);
  console.log(formatMetric('Avg CPU', avgCPU.toFixed(2), '%', { warning: 70, critical: 85 }));
  console.log(formatMetric('Max CPU', maxCPU.toFixed(2), '%', { warning: 70, critical: 85 }));
  console.log(formatMetric('Avg Memory', avgMemory.toFixed(2), '%', { warning: 70, critical: 85 }));
  console.log(formatMetric('Max Memory', maxMemory.toFixed(2), '%', { warning: 70, critical: 85 }));
  console.log(formatMetric('Max Connections', maxConnections, '', { warning: 100, critical: 500 }));

  // Save results
  fs.writeFileSync(outputFile, JSON.stringify({
    summary: {
      duration: (metrics.length * interval) / 1000 / 60,
      samples: metrics.length,
      avgCPU,
      maxCPU,
      avgMemory,
      maxMemory,
      maxConnections,
    },
    metrics,
  }, null, 2));

  console.log(`\n${colors.green}✓ Results saved to ${outputFile}${colors.reset}\n`);
}

// Handle signals
process.on('SIGINT', () => {
  console.log('\n\nInterrupted by user\n');
  process.exit(0);
});

// Start monitoring
monitor().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
