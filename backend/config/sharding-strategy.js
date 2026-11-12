/**
 * Database Sharding Strategy for MANAWA
 * Future scaling plan as data volume grows
 *
 * Current Status: NOT IMPLEMENTED (Monolithic)
 * Target Implementation: Phase 4+ (when daily active users > 100K)
 *
 * Sharding becomes necessary when:
 * - Single database exceeds 500GB
 * - Write throughput exceeds 5,000 QPS
 * - Query latency > 500ms even with optimization
 * - Infrastructure costs demand horizontal scaling
 */

class ShardingStrategy {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Get sharding trigger metrics
   * Determines when to implement sharding
   */
  getShardingTriggers() {
    return {
      database_size: {
        trigger: '500 GB',
        current_metric: 'TODO: Monitor with pg_database_size()',
        action: 'Evaluate sharding feasibility',
        monitoring_interval: 'Weekly',
      },
      qps_write: {
        trigger: '5,000 writes/sec',
        current_metric: 'TODO: Monitor with pg_stat_statements',
        action: 'Consider write-sharding or read replicas first',
        monitoring_interval: 'Hourly peak',
      },
      latency_p99: {
        trigger: '500 ms (p99)',
        current_metric: 'TODO: Monitor with application metrics',
        action: 'Investigate indexes/queries before sharding',
        monitoring_interval: 'Real-time',
      },
      user_count: {
        trigger: '100K daily active users',
        current_metric: 'TODO: Monitor in analytics',
        action: 'Begin sharding design phase',
        monitoring_interval: 'Daily',
      },
      storage_cost: {
        trigger: 'Monthly cost > $500',
        current_metric: 'TODO: Monitor AWS billing',
        action: 'Evaluate cost/benefit of sharding',
        monitoring_interval: 'Monthly',
      },
    };
  }

  /**
   * Recommended sharding key: User ID (by geography/market first)
   * Rationale:
   * - Most queries naturally partition by user
   * - Geographic segmentation matches business model (France initially)
   * - Allows country-specific sharding in future expansion
   */
  getShardingStrategy() {
    return {
      chosen_strategy: 'HASH-BASED GEOGRAPHIC SHARDING',
      sharding_key: 'userId (hash) → shard_id',
      primary_reason: 'User-centric application; queries naturally partition by user',

      implementation_phases: [
        {
          phase: 1,
          name: 'Single-Region Hash Sharding',
          description: 'Shard by hash(userId) % num_shards',
          num_shards: 4,
          deployment: 'Each shard = separate PostgreSQL instance in same region',
          queries: 'All queries know shard_id from userId hash',
          use_case: 'Current France-only operations',
        },
        {
          phase: 2,
          name: 'Multi-Region Geographic Sharding',
          description: 'Shard by country_code → region → shard',
          num_shards_per_region: 4,
          regions: ['FRANCE', 'GERMANY', 'SPAIN', 'ITALY'],
          deployment: 'Primary shard + read replicas per region',
          routing: 'Shard ID determined by User.country_code + hash(userId)',
          use_case: 'European expansion (Phase 4+)',
        },
        {
          phase: 3,
          name: 'Directory-Based Routing',
          description: 'Shard directory for flexible routing',
          components: [
            'Shard directory (metadata DB)',
            'Shard router (service)',
            'Per-shard databases',
            'Cross-shard queries via federated query engine',
          ],
          use_case: 'Global scale (100M+ users)',
        },
      ],

      alternative_strategies: {
        'Range-Based Sharding': {
          key: 'user_id ranges (1-1M, 1M-2M, etc.)',
          pros: 'Easy to implement, sequential IDs',
          cons: 'Uneven distribution, hot shards, hard to rebalance',
          recommendation: 'NOT recommended for MANAWA',
        },
        'Directory-Based Sharding': {
          key: 'User lookup table → shard_id',
          pros: 'Flexible routing, supports rebalancing',
          cons: 'Additional lookup overhead, single point of failure',
          recommendation: 'Consider for Phase 3+',
        },
        'Geographic Sharding': {
          key: 'User.country_code → shard',
          pros: 'Natural alignment with business expansion',
          cons: 'Uneven distribution across countries',
          recommendation: 'Use as primary strategy for international expansion',
        },
      },
    };
  }

  /**
   * Data models that should NOT be sharded
   * These remain in a shared "reference" database
   */
  getSharedReferenceTables() {
    return [
      'Trade',                    // Trade categories (fixed list)
      'Badge',                    // Professional badges (fixed list)
      'ServiceCategory',          // Service categories (fixed list)
      'AdminRoleType',            // Admin role definitions
      'SystemConfiguration',      // Global settings
      'Feature',                  // Feature flags
      'Region',                   // Geographic regions
    ];
  }

  /**
   * Data models that SHOULD be sharded by userId
   * Partitioned across shards for scale
   */
  getShardedTables() {
    return {
      primary: [
        { table: 'User', reason: 'Sharding key itself' },
        { table: 'Professional', reason: 'FK to User' },
        { table: 'Project', reason: 'FK to User (client)' },
        { table: 'Quote', reason: 'FK to Project' },
        { table: 'Payment', reason: 'FK to Quote' },
        { table: 'Booking', reason: 'FK to Project' },
        { table: 'Message', reason: 'FK to User (sender/receiver)' },
        { table: 'Review', reason: 'FK to User' },
        { table: 'Notification', reason: 'FK to User' },
        { table: 'Portfolio', reason: 'FK to Professional' },
        { table: 'Subscription', reason: 'FK to Professional' },
        { table: 'ServicePackage', reason: 'FK to Professional' },
        { table: 'Availability', reason: 'FK to Professional' },
      ],
      cross_shard: [
        { table: 'Follow', reason: 'Might span shards (follower ≠ followed)', strategy: 'Denormalize or fan-out' },
        { table: 'Referral', reason: 'Connects two users in different shards', strategy: 'Denormalize with both IDs' },
        { table: 'Dispute', reason: 'Involves two users', strategy: 'Keep in both shards or central DB' },
      ],
    };
  }

  /**
   * Sharding key distribution strategy
   */
  getShardingKeyStrategy() {
    return {
      current: {
        key: 'UUID (userId)',
        method: 'hash(userId) % num_shards',
        distribution: 'Deterministic, even load distribution',
        example: 'hash("f47ac10b-58cc-4372-a567-0e02b2c3d479") % 4 = shard_2',
      },
      benefits: [
        'Deterministic routing (no lookup needed)',
        'Even distribution (hash randomizes)',
        'Scalable (can increase shards later)',
        'Compatible with UUID primary keys',
      ],
      risks: [
        'Rebalancing data when shard count changes (requires resharding)',
        'Cross-shard queries become complex',
        'Transactions spanning shards fail',
      ],
    };
  }

  /**
   * Query routing logic
   * Shows how queries should be routed to correct shard
   */
  getQueryRoutingLogic() {
    return {
      single_shard_query: {
        example: 'SELECT * FROM Quote WHERE projectId = X',
        routing: `
          1. From projectId, lookup projectId → userId mapping (cached)
          2. Calculate shard_id = hash(userId) % num_shards
          3. Route query to shard_N database
          4. Execute and return
        `,
        latency: 'Single network hop + query',
      },
      multi_shard_query: {
        example: 'SELECT COUNT(*) FROM Quote WHERE createdAt > NOW() - 7 days',
        routing: `
          1. Send query to ALL shards in parallel
          2. Each shard returns its aggregation
          3. Combine results in application
          4. Return combined result
        `,
        latency: 'max(shard latencies) due to parallelization',
        complexity: 'High; requires union/merge logic',
      },
      cross_shard_join: {
        example: 'SELECT u.*, p.* FROM User u JOIN Professional p ON u.id = p.userId WHERE u.role = "PROFESSIONAL"',
        routing: `
          Option A - Denormalization: Store professionalId on User, query single shard
          Option B - Fan-out: Send to all shards, merge results in app
          Option C - Lookup table: Maintain shard_index table
        `,
        recommendation: 'Avoid cross-shard joins; design to shard by same key',
      },
    };
  }

  /**
   * Transaction handling across shards
   */
  getTransactionStrategy() {
    return {
      single_shard_transactions: {
        description: 'ACID transactions within single shard',
        implementation: 'Use PostgreSQL native transactions',
        reliability: '100%',
        use_case: 'All standard operations (single user context)',
      },
      distributed_transactions: {
        description: 'Transactions spanning multiple shards',
        implementation: 'Two-phase commit or saga pattern',
        reliability: '~95% (complex failure scenarios)',
        use_case: 'Rare (referral payouts, disputes)',
        recommendation: 'AVOID if possible; redesign to single-shard',
        pattern: 'Saga pattern (compensating transactions for rollback)',
      },
      eventual_consistency: {
        description: 'Accept temporary inconsistency across shards',
        implementation: 'Async writes, event-driven updates',
        reliability: 'Depends on implementation',
        use_case: 'Follower counts, analytics, notifications',
      },
    };
  }

  /**
   * Hot shard mitigation strategies
   */
  getHotShardMitigation() {
    return {
      problem: 'Some shards receive more traffic (celebrity users, popular services)',
      solutions: [
        {
          name: 'Cache hot data in Redis',
          example: 'Cache popular user profiles, frequently accessed data',
          benefit: 'Reduces queries to shard',
          cost: 'Memory in cache cluster',
        },
        {
          name: 'Read replicas per shard',
          example: 'Each shard has read replicas for reads',
          benefit: 'Distributes read load',
          cost: 'Replication lag, storage',
        },
        {
          name: 'Shard splitting',
          example: 'Split hot shard into two shards',
          benefit: 'Permanent solution for hot shards',
          cost: 'Complex migration, downtime',
        },
        {
          name: 'Cross-shard replication',
          example: 'Replicate hot data to other shards',
          benefit: 'Local reads near users',
          cost: 'Data consistency complexity',
        },
      ],
    };
  }

  /**
   * Migration plan from monolithic to sharded
   */
  getMigrationPlan() {
    return {
      phase_1: {
        name: 'Analysis & Design',
        duration: '2-4 weeks',
        tasks: [
          'Identify cross-shard queries',
          'Design shard directory',
          'Plan shard routing layer',
          'Identify data dependencies',
        ],
      },
      phase_2: {
        name: 'Implementation',
        duration: '4-8 weeks',
        tasks: [
          'Build shard routing service',
          'Create shard provisioning automation',
          'Implement shard-aware ORM',
          'Deploy shadow shards (non-prod)',
        ],
      },
      phase_3: {
        name: 'Data Migration',
        duration: '2-4 weeks',
        tasks: [
          'Create replica shards with copy',
          'Validate data integrity',
          'Setup dual-write mode',
          'Gradual traffic migration',
        ],
      },
      phase_4: {
        name: 'Cutover',
        duration: '1 day',
        tasks: [
          'Switch to sharded routing',
          'Verify all queries work',
          'Monitor error rates',
          'Maintain rollback capability',
        ],
      },
      phase_5: {
        name: 'Cleanup',
        duration: '2 weeks',
        tasks: [
          'Decommission old monolithic DB',
          'Archive old data',
          'Update documentation',
          'Training and runbooks',
        ],
      },
    };
  }

  /**
   * When NOT to shard
   */
  getShardingAntiPatterns() {
    return [
      'When data can fit in single database optimized with indexes',
      'When total data < 1TB and growing slowly',
      'When write throughput < 1000 QPS',
      'When team lacks operational expertise in sharding',
      'When most queries span multiple shards (join-heavy workload)',
      'Before exhausting other optimization: indexing, caching, read replicas',
      'Without a shard rebalancing strategy (becomes expensive to change)',
    ];
  }
}

module.exports = new ShardingStrategy();
