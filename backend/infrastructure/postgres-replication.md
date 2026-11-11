# PostgreSQL Replication & High Availability Setup

## Overview

MANAWA uses PostgreSQL streaming replication with a primary-replica topology for read scaling and disaster recovery. This document covers configuration, monitoring, and failover procedures.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Primary (Read/Write)                    │
│              Database (Primary DB)                   │
│  - Accepts all write operations                      │
│  - Generates WAL (Write-Ahead Logs)                  │
│  - Streams changes to replicas                       │
│  - Max connections: 200                              │
└─────────────────────────────────────────────────────┘
              │
              ├─ WAL Stream
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Read Replica 1 (Read-Only)                          │
│  - Accepts SELECT queries only                       │
│  - Continuous recovery from WAL                      │
│  - Replication lag: <5 seconds (typical)             │
│  - Max connections: 100                              │
└─────────────────────────────────────────────────────┘

              ├─ WAL Stream
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Read Replica 2 (Read-Only)                          │
│  - Accepts SELECT queries only                       │
│  - Continuous recovery from WAL                      │
│  - Replication lag: <5 seconds (typical)             │
│  - Max connections: 100                              │
└─────────────────────────────────────────────────────┘
```

## Replication Modes

### Asynchronous Replication (Default)

**Configuration:**
```bash
# Primary server (postgresql.conf)
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
hot_standby_feedback = on
synchronous_commit = off
```

**Characteristics:**
- Write commits don't wait for replica acknowledgment
- Faster write performance
- RPO (Recovery Point Objective): Up to a few seconds
- RTO (Recovery Time Objective): ~5 minutes
- Best for: Applications that can tolerate minor data loss

**Recovery Scenario:**
1. Primary crashes
2. Data committed to primary but not yet replicated is lost
3. Replica promoted to primary (manual or automatic)
4. Applications reconnect to new primary

### Synchronous Replication (Optional)

**Configuration:**
```bash
# Primary server (postgresql.conf)
synchronous_commit = remote_write  # or remote_apply
synchronous_standby_names = 'replica1,replica2'
```

**Characteristics:**
- Write commits wait for at least one replica acknowledgment
- Slower write performance (higher latency)
- RPO: Near zero (all committed data replicated)
- RTO: ~5 minutes
- Best for: Critical financial data, compliance requirements

**Trade-offs:**
```
┌─────────────────┬──────────────────┬──────────────────┐
│ Mode            │ Write Performance │ Data Safety      │
├─────────────────┼──────────────────┼──────────────────┤
│ Asynchronous    │ Fast             │ Minor data loss  │
│ Remote Write    │ Slower (50-100ms)│ Very high        │
│ Remote Apply    │ Slower (100-300ms)│ Highest         │
└─────────────────┴──────────────────┴──────────────────┘
```

## Primary-Replica Configuration

### Primary Setup (postgresql.conf)

```ini
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Replication Settings
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# WAL (Write-Ahead Logging) - Required for replication
wal_level = replica
max_wal_senders = 10           # Max number of replica connections
max_replication_slots = 10     # Prevent WAL removal if replica lags
hot_standby = on               # Allow queries during recovery

# Synchronization
synchronous_commit = off       # Faster writes, asynchronous replication
synchronous_standby_names = '' # Empty = asynchronous

# Connection settings
max_connections = 200
reserved_connections = 10     # Reserve for superuser

# Performance
shared_buffers = 4GB           # ~25% of total RAM
effective_cache_size = 12GB    # ~75% of total RAM
work_mem = 10MB
maintenance_work_mem = 1GB
checkpoint_timeout = 15min

# Logging
log_replication_commands = on
log_connections = on
log_disconnections = on
```

### Primary Authentication (pg_hba.conf)

```bash
# IPv4 local connections (primary to replica)
host    replication    replicator    10.0.0.0/8    md5
host    replication    replicator    172.16.0.0/12 md5
host    replication    replicator    192.168.0.0/16 md5

# IPv6 local connections
host    replication    replicator    ::1/128       md5
host    replication    replicator    fc00::/7      md5

# Application connections
host    manawa         app_user      10.0.0.0/8    md5
host    manawa         app_user      0.0.0.0/0     md5
```

### Create Replication User

```sql
-- On primary database
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'strong_password_here';

-- Grant privileges
ALTER ROLE replicator SUPERUSER;

-- Create replication slot
SELECT * FROM pg_create_physical_replication_slot('replica1_slot');
SELECT * FROM pg_create_physical_replication_slot('replica2_slot');
```

### Replica Setup (recovery.conf or postgresql.auto.conf)

```ini
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Replica Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

standby_mode = on
primary_conninfo = 'host=primary.example.com port=5432 user=replicator password=strong_password_here'
primary_slot_name = 'replica1_slot'

# Hot standby settings
hot_standby = on
hot_standby_feedback = on      # Prevent vacuum on primary until replica reads
max_standby_streaming_delay = 30s
wal_retrieve_retry_interval = 5s

# Recovery settings
recovery_target_timeline = 'latest'
restore_command = 'exit 0'
```

## Replication Monitoring

### Monitor Replication Status

```sql
-- On primary: Check active replicas
SELECT
  slot_name,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS bytes_behind
FROM pg_replication_slots
WHERE slot_type = 'physical';

-- Output example:
--  slot_name  | slot_type | active | restart_lsn | confirmed_flush_lsn | bytes_behind
-- ────────────┼───────────┼────────┼─────────────┼─────────────────────┼──────────────
--  replica1   | physical  | t      | 0/30000028  | 0/30000028          | 0
--  replica2   | physical  | t      | 0/30000028  | 0/30000028          | 0
```

### Monitor Replica Lag

```sql
-- On primary: Check replication lag in seconds
SELECT
  client_addr,
  write_lag,
  flush_lag,
  replay_lag,
  EXTRACT(EPOCH FROM write_lag) AS write_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds
FROM pg_stat_replication;

-- Output example:
--  client_addr | write_lag | flush_lag | replay_lag | write_lag_seconds | replay_lag_seconds
-- ─────────────┼───────────┼───────────┼───────────┼──────────────────┼────────────────────
--  10.0.0.10   | 00:00:00.5| 00:00:00.5| 00:00:00.5| 0.5               | 0.5
```

### Monitor WAL Archiving

```sql
-- Check WAL files waiting to be archived
SELECT
  name,
  size,
  modification
FROM pg_ls_dir('pg_wal') AS name
WHERE name ~ '^[0-9A-F]{24}$'
ORDER BY modification DESC
LIMIT 10;
```

## Health Check Script

The health check runs every 5 minutes and monitors:

```javascript
// config/database-replication.js
async healthCheck() {
  // Check primary connection
  // Check each replica connection
  // Monitor replication lag
  // Detect failover scenarios
}

// Metrics monitored:
// - Primary connectivity: true/false
// - Each replica connectivity: true/false
// - Replication lag per replica: seconds
// - Primary uptime: seconds
// - Last failover timestamp
```

## Failover Procedures

### Manual Failover (Planned Downtime)

**Scenario:** Maintenance on primary, safe replica promotion

```bash
# 1. On primary: Stop accepting write connections
ALTER SYSTEM SET max_connections = 10;
SELECT pg_reload_conf();

# 2. Wait for replicas to catch up (zero lag)
SELECT write_lag, flush_lag, replay_lag FROM pg_stat_replication;

# 3. Promote replica to primary
# 3a. On replica (as postgres user):
pg_ctl promote -D /var/lib/postgresql/12/main

# 3b. Or via SQL on replica:
SELECT pg_promote();

# 4. Update DNS/connection strings to point to new primary
# - Update DATABASE_PRIMARY_URL environment variable
# - Restart application servers

# 5. Old primary becomes new replica when restarted
# Configure as standby (see setup steps above)
```

### Automatic Failover (Unplanned Downtime)

**Scenario:** Primary crashes unexpectedly

```bash
# 1. Monitoring detects primary down (3 failed health checks)
# 2. Highest priority replica is promoted automatically
# 3. Alert sent to operations team
# 4. DNS updated by infrastructure (if configured)
# 5. Applications reconnect with retry logic

# Recovery steps:
# 1. Investigate primary failure
# 2. Restore primary or set up new primary
# 3. Configure as replica of new primary
# 4. After synchronization, consider re-promoting for symmetry
```

### Application Failover Handling

```javascript
// config/database-replication.js
const replication = require('./config/database-replication');

// Initialize with both primary and replicas
await replication.initPrimary();
await replication.initReadReplicas();

// Reads use replica (automatic fallback to primary if all replicas down)
const readDb = replication.getReadReplica(); // Round-robin

// Writes always use primary (fail if primary down)
const writeDb = replication.getPrimary();

// Automatic retry with exponential backoff
async function executeWithRetry(query, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await query();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = Math.pow(2, i) * 100; // 100ms, 200ms, 400ms
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## Performance Impact

### Read Scaling

```
┌──────────────────────────────────────────────────────┐
│ Primary Database Performance                         │
├──────────────────────────────────────────────────────┤
│ Writes: 100% on primary                              │
│ Reads: 0% (all writes still require primary hit)     │
│                                                       │
│ Expected throughput: ~1000 writes/sec on primary     │
└──────────────────────────────────────────────────────┘

With replicas:

┌──────────────────────────────────────────────────────┐
│ Primary:     40% reads  (cache-heavy queries)        │
│ Replica 1:   40% reads  (analytics, batch jobs)      │
│ Replica 2:   40% reads  (mobile app queries)         │
│                                                       │
│ Net result: 3x read throughput vs single instance    │
│ Writes: Limited to primary capacity                  │
└──────────────────────────────────────────────────────┘
```

## Monitoring Queries

### Dashboard Metrics

```sql
-- Replication Status
SELECT
  NOW(),
  COUNT(*) as replica_count,
  COALESCE(SUM(CASE WHEN active THEN 1 ELSE 0 END), 0) as active_replicas,
  COALESCE(MIN(EXTRACT(EPOCH FROM (now() - slot_creation_time))), 0) as oldest_slot_age_seconds
FROM pg_replication_slots;

-- WAL Generation Rate
SELECT
  EXTRACT(EPOCH FROM (now() - (SELECT pg_postmaster_start_time()))) as uptime_seconds,
  pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') / 1024 / 1024 as wal_generated_mb
FROM pg_control_system;

-- Connection Counts
SELECT
  NOW(),
  (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
  (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
  (SELECT COUNT(*) FROM pg_stat_activity) as total_connections,
  (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections;
```

## Troubleshooting

### Replica Lag Increasing

```bash
# Check for long-running transactions on primary
SELECT pid, usename, query_start, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

# Cancel long-running queries if necessary
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE pid != pg_backend_pid()
AND usename = 'app_user'
AND query_start < now() - interval '1 hour';

# Check WAL generation on primary
SELECT * FROM pg_stat_database WHERE datname = 'manawa';
```

### Replica Connection Lost

```bash
# On replica: Check connection status
SELECT * FROM pg_stat_replication_slots;

# On replica: Check logs
tail -f /var/log/postgresql/postgresql.log | grep replication

# Restart replication
pg_ctl restart -D /var/lib/postgresql/data

# Monitor recovery
SELECT pg_is_in_recovery();
```

### Cannot Connect to Replica

```bash
# Check pg_hba.conf on primary
grep replicator /etc/postgresql/pg_hba.conf

# Test network connectivity
psql -h replica.example.com -U replicator -d replication -c "IDENTIFY_SYSTEM"

# Check firewall (TCP 5432)
netstat -anp | grep 5432
telnet replica.example.com 5432
```

## Best Practices

1. **Monitor Replication Lag:** Alert if lag > 60 seconds
2. **Test Failover Regularly:** Monthly failover drills
3. **Maintain Separate Hardware:** Replicas on different physical servers
4. **Use Connection Pooling:** PgBouncer for connection management
5. **Enable Hot Standby Feedback:** Prevent unnecessary vacuums
6. **Archive WAL Files:** Enable PITR with S3 storage
7. **Monitor Disk Space:** Ensure WAL directory has sufficient space
8. **Use Async for Performance:** Synchronous only for critical data
9. **Document Failover Process:** Keep runbook updated
10. **Test Recovery Procedures:** Validate PITR works as expected

## References

- PostgreSQL Documentation: https://www.postgresql.org/docs/current/warm-standby.html
- Replication & Failover: https://www.postgresql.org/docs/current/warm-standby-failover.html
- WAL Configuration: https://www.postgresql.org/docs/current/wal-configuration.html
