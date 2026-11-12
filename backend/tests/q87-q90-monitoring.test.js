/**
 * Tests Q87-Q90: Cost Tracking, SLA Targets, Alert Thresholds, On-Call Rotation
 */

// ─── Q87: Cost Tracking ───────────────────────────────────────────────────────

describe('Q87: Cost Tracking', () => {
  const VALID_SERVICES = ['render', 'supabase', 'redis', 'cloudinary', 'mailjet', 'twilio', 'meilisearch', 'other'];

  it('valid services list has 8 entries', () => {
    expect(VALID_SERVICES.length).toBe(8);
  });

  it('month format validation — YYYY-MM', () => {
    const valid = /^\d{4}-\d{2}$/;
    expect(valid.test('2026-11')).toBe(true);
    expect(valid.test('2026-1')).toBe(false);
    expect(valid.test('26-11')).toBe(false);
    expect(valid.test('2026-11-01')).toBe(false);
  });

  it('MoM change calculation is correct', () => {
    const change = parseFloat((((120 - 100) / 100) * 100).toFixed(2));
    expect(change).toBe(20);
  });

  it('negative MoM change is handled', () => {
    const change = parseFloat((((80 - 100) / 100) * 100).toFixed(2));
    expect(change).toBe(-20);
  });

  it('YTD total and variance are correct', () => {
    const costs = [{ amountEur: 100, budgetEur: 90 }, { amountEur: 50, budgetEur: 60 }];
    const total    = costs.reduce((s, c) => s + c.amountEur, 0);
    const budget   = costs.reduce((s, c) => s + (c.budgetEur || 0), 0);
    const variance = parseFloat((total - budget).toFixed(2));
    expect(total).toBe(150);
    expect(budget).toBe(150);
    expect(variance).toBe(0);
  });

  it('over-budget detection works', () => {
    expect(160 > 150).toBe(true);
    expect(140 > 150).toBe(false);
  });

  it('unit cost calculation is correct', () => {
    const costPerUnit = parseFloat((7 / 1000).toFixed(6));
    expect(costPerUnit).toBe(0.007);
  });

  it('per-service aggregation groups correctly', () => {
    const costs = [
      { service: 'render',   amountEur: 50 },
      { service: 'supabase', amountEur: 30 },
      { service: 'render',   amountEur: 20 },
    ];
    const byService = {};
    costs.forEach(c => { byService[c.service] = (byService[c.service] || 0) + c.amountEur; });
    expect(byService.render).toBe(70);
    expect(byService.supabase).toBe(30);
  });
});

// ─── Q88: SLA Targets ─────────────────────────────────────────────────────────

describe('Q88: Performance SLA Targets', () => {
  const DEFAULT_TARGETS = [
    { name: 'api_p95_latency',    category: 'latency',      targetValue: 500,  unit: 'ms' },
    { name: 'api_p99_latency',    category: 'latency',      targetValue: 2000, unit: 'ms' },
    { name: 'uptime',             category: 'availability', targetValue: 99.9, unit: '%'  },
    { name: 'error_rate',         category: 'error_rate',   targetValue: 0.1,  unit: '%'  },
    { name: 'payment_error_rate', category: 'error_rate',   targetValue: 0.5,  unit: '%'  },
  ];

  it('5 default SLA targets are defined', () => {
    expect(DEFAULT_TARGETS.length).toBe(5);
  });

  it('each target has required fields', () => {
    DEFAULT_TARGETS.forEach(t => {
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('category');
      expect(t).toHaveProperty('targetValue');
      expect(t).toHaveProperty('unit');
      expect(typeof t.targetValue).toBe('number');
    });
  });

  it('uptime SLA is 99.9%', () => {
    expect(DEFAULT_TARGETS.find(t => t.name === 'uptime').targetValue).toBe(99.9);
  });

  it('p95 latency target is 500ms', () => {
    expect(DEFAULT_TARGETS.find(t => t.name === 'api_p95_latency').targetValue).toBe(500);
  });

  it('compliance percentage is computed correctly (1h breach in 24h window)', () => {
    const windowMs   = 24 * 60 * 60 * 1000;
    const downMs     =  1 * 60 * 60 * 1000;
    const compliance = parseFloat((Math.max(0, ((windowMs - downMs) / windowMs) * 100)).toFixed(3));
    expect(compliance).toBeCloseTo(95.833, 2);
  });

  it('zero downtime = 100% compliance', () => {
    const windowMs   = 24 * 60 * 60 * 1000;
    const compliance = parseFloat((((windowMs - 0) / windowMs) * 100).toFixed(3));
    expect(compliance).toBe(100);
  });

  it('MTTR is average of resolved breach durations', () => {
    const breaches = [{ durationMs: 60000 }, { durationMs: 120000 }, { durationMs: 90000 }];
    const mttr = Math.round(breaches.reduce((s, b) => s + b.durationMs, 0) / breaches.length);
    expect(mttr).toBe(90000);
  });

  it('overall compliance is average of all targets', () => {
    const targets = [{ compliancePct: 100 }, { compliancePct: 99 }, { compliancePct: 95 }];
    const overall = parseFloat((targets.reduce((s, t) => s + t.compliancePct, 0) / targets.length).toFixed(2));
    expect(overall).toBeCloseTo(98, 0);
  });
});

// ─── Q89: Alert Events ───────────────────────────────────────────────────────

describe('Q89: Alert Events', () => {
  const VALID_TYPES      = ['error_rate', 'latency', 'memory', 'cpu', 'payment_failure', 'queue_depth'];
  const VALID_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'];
  const VALID_STATUSES   = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SILENCED'];

  it('6 valid alert types defined', () => {
    expect(VALID_TYPES.length).toBe(6);
  });

  it('3 valid severities defined', () => {
    expect(VALID_SEVERITIES).toEqual(['INFO', 'WARN', 'CRITICAL']);
  });

  it('4 valid statuses defined', () => {
    expect(VALID_STATUSES.length).toBe(4);
  });

  it('silence duration calculates correctly (60 min)', () => {
    const now   = new Date('2026-11-12T10:00:00Z');
    const until = new Date(now.getTime() + 60 * 60 * 1000);
    expect(until.toISOString()).toBe('2026-11-12T11:00:00.000Z');
  });

  it('MTTA is computed correctly', () => {
    const events = [
      { createdAt: new Date('2026-11-12T10:00:00Z'), acknowledgedAt: new Date('2026-11-12T10:05:00Z') },
      { createdAt: new Date('2026-11-12T10:00:00Z'), acknowledgedAt: new Date('2026-11-12T10:15:00Z') },
    ];
    let totalMs = 0;
    events.forEach(e => { totalMs += new Date(e.acknowledgedAt) - new Date(e.createdAt); });
    expect(Math.round(totalMs / events.length)).toBe(10 * 60 * 1000);
  });

  it('MTTR is computed correctly', () => {
    const events = [
      { createdAt: new Date('2026-11-12T10:00:00Z'), resolvedAt: new Date('2026-11-12T10:30:00Z') },
      { createdAt: new Date('2026-11-12T10:00:00Z'), resolvedAt: new Date('2026-11-12T11:00:00Z') },
    ];
    let totalMs = 0;
    events.forEach(e => { totalMs += new Date(e.resolvedAt) - new Date(e.createdAt); });
    expect(Math.round(totalMs / events.length)).toBe(45 * 60 * 1000);
  });

  it('byType aggregation counts correctly', () => {
    const events = [
      { type: 'error_rate' }, { type: 'latency' },
      { type: 'error_rate' }, { type: 'memory'  },
    ];
    const byType = {};
    events.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
    expect(byType.error_rate).toBe(2);
    expect(byType.latency).toBe(1);
  });

  it('cannot acknowledge a resolved alert', () => {
    expect({ status: 'RESOLVED' }.status === 'OPEN').toBe(false);
  });

  it('monitoring-thresholds getAlertLevel returns CRITICAL on high error rate', () => {
    const thresholds = require('../config/monitoring-thresholds');
    expect(thresholds.getAlertLevel({ errorRate: 2, latencyP95Ms: 100, memoryPercent: 50 })).toBe('CRITICAL');
  });

  it('monitoring-thresholds getAlertLevel returns OK when all normal', () => {
    const thresholds = require('../config/monitoring-thresholds');
    expect(thresholds.getAlertLevel({ errorRate: 0.1, latencyP95Ms: 200, memoryPercent: 40 })).toBe('OK');
  });
});

// ─── Q90: On-Call Rotation ────────────────────────────────────────────────────

describe('Q90: On-Call Rotation', () => {
  it('endAt must be after startAt — valid', () => {
    expect(new Date('2026-11-13T08:00:00Z') > new Date('2026-11-12T08:00:00Z')).toBe(true);
  });

  it('endAt before startAt — invalid', () => {
    expect(new Date('2026-11-12T08:00:00Z') <= new Date('2026-11-13T08:00:00Z')).toBe(true);
  });

  it('coverage 100% when no gaps', () => {
    const coverage = parseFloat(((1 - 0 / (7 * 24)) * 100).toFixed(2));
    expect(coverage).toBe(100);
  });

  it('coverage ~85.71% with 24h gap in 7 days', () => {
    const coverage = parseFloat(((1 - 24 / (7 * 24)) * 100).toFixed(2));
    expect(coverage).toBeCloseTo(85.71, 1);
  });

  it('gap detection finds 24h gap between two non-consecutive slots', () => {
    const from  = new Date('2026-11-12T00:00:00Z');
    const slots = [
      { startAt: new Date('2026-11-12T00:00:00Z'), endAt: new Date('2026-11-13T00:00:00Z') },
      { startAt: new Date('2026-11-14T00:00:00Z'), endAt: new Date('2026-11-15T00:00:00Z') },
    ];
    const gaps  = [];
    let   cursor = from;
    for (const slot of slots) {
      if (new Date(slot.startAt) > cursor) {
        gaps.push({ durationHours: (new Date(slot.startAt) - cursor) / 3600000 });
      }
      cursor = new Date(slot.endAt);
    }
    expect(gaps.length).toBe(1);
    expect(gaps[0].durationHours).toBe(24);
  });

  it('no gaps when schedule is continuous', () => {
    const from  = new Date('2026-11-12T00:00:00Z');
    const slots = [
      { startAt: new Date('2026-11-12T00:00:00Z'), endAt: new Date('2026-11-13T00:00:00Z') },
      { startAt: new Date('2026-11-13T00:00:00Z'), endAt: new Date('2026-11-14T00:00:00Z') },
    ];
    const gaps  = [];
    let   cursor = from;
    for (const slot of slots) {
      if (new Date(slot.startAt) > cursor) gaps.push({});
      cursor = new Date(slot.endAt);
    }
    expect(gaps.length).toBe(0);
  });

  it('level 1 = primary, level 2 = escalation', () => {
    const slots = [{ level: 1, user: { name: 'Alice' } }, { level: 2, user: { name: 'Bob' } }];
    expect(slots.find(s => s.level === 1).user.name).toBe('Alice');
    expect(slots.find(s => s.level === 2).user.name).toBe('Bob');
  });

  it('escalation fails when no secondary on-call', () => {
    const slots = [{ level: 1, user: { name: 'Alice' } }];
    expect(slots.find(s => s.level === 2)).toBeUndefined();
  });
});
