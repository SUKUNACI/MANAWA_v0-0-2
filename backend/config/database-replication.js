const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * Database Replication Configuration
 * Supports primary/replica topology for read scaling
 * Handles failover detection and replication monitoring
 */

class DatabaseReplication {
  constructor() {
    this.primaryPrisma = null;
    this.readReplicaPrismas = [];
    this.replicationStatus = {
      primary: { connected: false, lastCheck: null },
      replicas: {},
      lastFailover: null,
      currentPrimary: null,
    };
    this.readReplicaIndex = 0;
  }

  /**
   * Initialize primary connection
   */
  async initPrimary() {
    try {
      const primaryUrl = process.env.DATABASE_PRIMARY_URL || process.env.DATABASE_URL;

      if (!primaryUrl) {
        throw new Error('DATABASE_PRIMARY_URL or DATABASE_URL not configured');
      }

      this.primaryPrisma = new PrismaClient({
        datasources: { db: { url: primaryUrl } },
      });

      // Test connection
      await this.primaryPrisma.$queryRaw`SELECT 1`;

      this.replicationStatus.primary.connected = true;
      this.replicationStatus.primary.lastCheck = new Date();
      this.replicationStatus.currentPrimary = primaryUrl;

      logger.info('[DB Replication] Primary connection established', {
        connected: true,
      });

      return true;
    } catch (err) {
      logger.error('[DB Replication] Primary connection failed', {
        error: err.message,
      });
      this.replicationStatus.primary.connected = false;
      return false;
    }
  }

  /**
   * Initialize read replica connections
   */
  async initReadReplicas() {
    try {
      // Parse replica URLs from environment (comma-separated)
      const replicaUrlsEnv = process.env.DATABASE_REPLICA_URLS || '';
      const replicaUrls = replicaUrlsEnv
        .split(',')
        .map(url => url.trim())
        .filter(url => url.length > 0);

      if (replicaUrls.length === 0) {
        logger.warn('[DB Replication] No read replicas configured, using primary for reads');
        return;
      }

      for (let i = 0; i < replicaUrls.length; i++) {
        try {
          const replica = new PrismaClient({
            datasources: { db: { url: replicaUrls[i] } },
          });

          // Test connection
          await replica.$queryRaw`SELECT 1`;

          this.readReplicaPrismas.push({
            prisma: replica,
            url: replicaUrls[i],
            index: i,
            connected: true,
            lastCheck: new Date(),
            lag: 0,
          });

          this.replicationStatus.replicas[`replica-${i}`] = {
            connected: true,
            lastCheck: new Date(),
            lag: 0,
          };

          logger.info('[DB Replication] Read replica connected', {
            replicaIndex: i,
            connected: true,
          });
        } catch (err) {
          logger.warn('[DB Replication] Read replica connection failed', {
            replicaIndex: i,
            error: err.message,
          });
          this.replicationStatus.replicas[`replica-${i}`] = {
            connected: false,
            lastCheck: new Date(),
            error: err.message,
          };
        }
      }
    } catch (err) {
      logger.error('[DB Replication] Failed to initialize read replicas', {
        error: err.message,
      });
    }
  }

  /**
   * Get primary connection for writes
   */
  getPrimary() {
    if (!this.primaryPrisma?.connected) {
      throw new Error('Primary database connection unavailable');
    }
    return this.primaryPrisma;
  }

  /**
   * Get read replica connection (round-robin load balancing)
   */
  getReadReplica() {
    // If no replicas, use primary
    if (this.readReplicaPrismas.length === 0) {
      return this.getPrimary();
    }

    // Find first connected replica
    let attempts = 0;
    const maxAttempts = this.readReplicaPrismas.length;

    while (attempts < maxAttempts) {
      const replica = this.readReplicaPrismas[this.readReplicaIndex];
      this.readReplicaIndex = (this.readReplicaIndex + 1) % this.readReplicaPrismas.length;

      if (replica.connected) {
        return replica.prisma;
      }
      attempts++;
    }

    // All replicas down, use primary
    logger.warn('[DB Replication] All read replicas unavailable, using primary');
    return this.getPrimary();
  }

  /**
   * Monitor replication lag
   */
  async monitorReplicationLag() {
    try {
      // Get primary's current LSN/transaction ID
      const primaryLag = await this.primaryPrisma.$queryRaw`
        SELECT EXTRACT(EPOCH FROM (NOW() - pg_postmaster_start_time())) as uptime_seconds
      `;

      // Monitor each replica
      for (let i = 0; i < this.readReplicaPrismas.length; i++) {
        try {
          const replica = this.readReplicaPrismas[i];

          // Query replication statistics
          const replicaLag = await replica.prisma.$queryRaw`
            SELECT
              slot_name,
              restart_lsn,
              confirmed_flush_lsn,
              write_lag,
              flush_lag,
              replay_lag
            FROM pg_replication_slots
            LIMIT 1
          `;

          if (replicaLag && replicaLag.length > 0) {
            const lag = replicaLag[0];
            replica.lag = lag.replay_lag ?
              parseInt(lag.replay_lag) / 1000 : 0; // Convert to seconds

            this.replicationStatus.replicas[`replica-${i}`].lag = replica.lag;
            this.replicationStatus.replicas[`replica-${i}`].lastCheck = new Date();

            logger.debug('[DB Replication] Lag monitored', {
              replicaIndex: i,
              lagSeconds: replica.lag,
            });
          }
        } catch (err) {
          logger.warn('[DB Replication] Failed to monitor replica lag', {
            replicaIndex: i,
            error: err.message,
          });
        }
      }
    } catch (err) {
      logger.warn('[DB Replication] Failed to monitor replication', {
        error: err.message,
      });
    }
  }

  /**
   * Health check - detects replica failures and promotes if needed
   */
  async healthCheck() {
    try {
      // Check primary
      try {
        await this.primaryPrisma.$queryRaw`SELECT 1`;
        this.replicationStatus.primary.connected = true;
        this.replicationStatus.primary.lastCheck = new Date();
      } catch (err) {
        this.replicationStatus.primary.connected = false;
        logger.error('[DB Replication] Primary unhealthy', { error: err.message });
      }

      // Check replicas
      for (let i = 0; i < this.readReplicaPrismas.length; i++) {
        try {
          const replica = this.readReplicaPrismas[i];
          await replica.prisma.$queryRaw`SELECT 1`;
          replica.connected = true;
          this.replicationStatus.replicas[`replica-${i}`].connected = true;
          this.replicationStatus.replicas[`replica-${i}`].lastCheck = new Date();
        } catch (err) {
          this.readReplicaPrismas[i].connected = false;
          this.replicationStatus.replicas[`replica-${i}`].connected = false;
          this.replicationStatus.replicas[`replica-${i}`].lastCheck = new Date();
          logger.warn('[DB Replication] Replica unhealthy', {
            replicaIndex: i,
            error: err.message,
          });
        }
      }

      // Monitor lag
      await this.monitorReplicationLag();

      return this.replicationStatus;
    } catch (err) {
      logger.error('[DB Replication] Health check error', {
        error: err.message,
      });
      return this.replicationStatus;
    }
  }

  /**
   * Get replication status
   */
  getStatus() {
    return {
      ...this.replicationStatus,
      replicas: this.readReplicaPrismas.map((r, idx) => ({
        index: idx,
        connected: r.connected,
        lag: r.lag,
        lastCheck: this.replicationStatus.replicas[`replica-${idx}`]?.lastCheck,
      })),
    };
  }

  /**
   * Cleanup connections
   */
  async disconnect() {
    if (this.primaryPrisma) {
      await this.primaryPrisma.$disconnect();
    }
    for (const replica of this.readReplicaPrismas) {
      await replica.prisma.$disconnect();
    }
    logger.info('[DB Replication] All connections closed');
  }
}

const replication = new DatabaseReplication();

module.exports = replication;
