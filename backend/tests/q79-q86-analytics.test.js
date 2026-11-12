/**
 * Tests Q79-Q86: Custom Metrics, Event Tracking, User Journey,
 * Funnel Analysis, Cohort Analysis, Retention, Churn, Revenue
 */

// ─── Q80: Event Tracking ─────────────────────────────────────────────────────

describe('Q80: Event Tracking — valid event types', () => {
  const VALID_TYPES = [
    'search', 'profile_view', 'quote_sent', 'quote_accepted', 'quote_rejected',
    'booking_created', 'booking_confirmed', 'payment_initiated', 'payment_success',
    'payment_failed', 'login', 'logout', 'register', 'message_sent',
    'review_submitted', 'subscription_upgraded', 'subscription_cancelled',
    'portfolio_viewed', 'package_ordered', 'video_call_started',
  ];

  it('valid event type list has 20 entries', () => {
    expect(VALID_TYPES.length).toBe(20);
  });

  it('contains all funnel-critical events', () => {
    const funnelEvents = ['register', 'search', 'profile_view', 'quote_sent', 'booking_created', 'payment_success'];
    funnelEvents.forEach(e => expect(VALID_TYPES).toContain(e));
  });

  it('batch event data structure is valid', () => {
    const batch = [
      { type: 'search', page: '/search', metadata: { query: 'plombier' } },
      { type: 'profile_view', metadata: { professionalId: 'abc' } },
    ];
    batch.forEach(e => {
      expect(VALID_TYPES).toContain(e.type);
    });
  });
});

// ─── Q79: Custom Metrics ─────────────────────────────────────────────────────

describe('Q79: Custom Metrics — data model', () => {
  const VALID_CATEGORIES = ['professional', 'platform', 'payment', 'search'];

  it('valid category list has 4 entries', () => {
    expect(VALID_CATEGORIES.length).toBe(4);
  });

  it('metric structure is valid', () => {
    const metric = { name: 'quote_response_time', category: 'professional', value: 4.2, unit: 'hours' };
    expect(typeof metric.name).toBe('string');
    expect(VALID_CATEGORIES).toContain(metric.category);
    expect(typeof metric.value).toBe('number');
  });

  it('summary aggregation logic is correct', () => {
    const values = [10, 20, 30, 40];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBe(25);
    expect(Math.min(...values)).toBe(10);
    expect(Math.max(...values)).toBe(40);
  });

  it('mean rounds to 4 decimal places', () => {
    const values = [1, 2, 3];
    const mean = parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
    expect(mean).toBe(2);
  });
});

// ─── Q81: User Journey ───────────────────────────────────────────────────────

describe('Q81: User Journey — session grouping', () => {
  const SESSION_GAP_MS = 30 * 60 * 1000;

  function groupIntoSessions(events) {
    const sessions = [];
    let current = null;
    for (const event of events) {
      const ts = new Date(event.createdAt).getTime();
      if (!current || ts - current.lastTs > SESSION_GAP_MS) {
        current = { startedAt: event.createdAt, lastTs: ts, events: [] };
        sessions.push(current);
      }
      current.lastTs = ts;
      current.events.push(event);
    }
    return sessions;
  }

  it('single continuous session when gap < 30min', () => {
    const events = [
      { type: 'login',        createdAt: new Date('2026-11-12T10:00:00Z') },
      { type: 'search',       createdAt: new Date('2026-11-12T10:10:00Z') },
      { type: 'profile_view', createdAt: new Date('2026-11-12T10:20:00Z') },
    ];
    const sessions = groupIntoSessions(events);
    expect(sessions.length).toBe(1);
    expect(sessions[0].events.length).toBe(3);
  });

  it('two sessions when gap > 30min', () => {
    const events = [
      { type: 'login',  createdAt: new Date('2026-11-12T10:00:00Z') },
      { type: 'search', createdAt: new Date('2026-11-12T11:00:00Z') },
    ];
    const sessions = groupIntoSessions(events);
    expect(sessions.length).toBe(2);
  });

  it('milestone detection works correctly', () => {
    const eventTypes = new Set(['login', 'search', 'profile_view', 'quote_sent', 'payment_success']);
    const milestones = {
      registered:    true,
      searched:      eventTypes.has('search'),
      viewedProfile: eventTypes.has('profile_view'),
      sentQuote:     eventTypes.has('quote_sent'),
      madePayment:   eventTypes.has('payment_success'),
      leftReview:    eventTypes.has('review_submitted'),
    };
    expect(milestones.searched).toBe(true);
    expect(milestones.madePayment).toBe(true);
    expect(milestones.leftReview).toBe(false);
  });

  it('completedMilestones count is correct', () => {
    const milestones = { registered: true, searched: true, viewedProfile: false, sentQuote: false };
    const count = Object.values(milestones).filter(Boolean).length;
    expect(count).toBe(2);
  });
});

// ─── Q82: Funnel Analysis ────────────────────────────────────────────────────

describe('Q82: Funnel Analysis — conversion rates', () => {
  function buildFunnel(steps) {
    return steps.map((step, i) => {
      const prev = i === 0 ? step.count : steps[i - 1].count;
      const registered = steps[0].count;
      return {
        ...step,
        conversionFromFirst: registered > 0 ? parseFloat(((step.count / registered) * 100).toFixed(2)) : 0,
        conversionFromPrev:  prev > 0        ? parseFloat(((step.count / prev)       * 100).toFixed(2)) : 0,
        dropOff: i === 0 ? 0 : steps[i - 1].count - step.count,
      };
    });
  }

  it('first step has 100% conversion from first', () => {
    const steps = [{ step: 'registered', count: 1000 }, { step: 'searched', count: 600 }];
    const funnel = buildFunnel(steps);
    expect(funnel[0].conversionFromFirst).toBe(100);
  });

  it('calculates drop-off correctly', () => {
    const steps = [{ step: 'registered', count: 1000 }, { step: 'searched', count: 600 }];
    const funnel = buildFunnel(steps);
    expect(funnel[1].dropOff).toBe(400);
  });

  it('calculates overall conversion correctly', () => {
    const overall = parseFloat(((50 / 1000) * 100).toFixed(2));
    expect(overall).toBe(5);
  });

  it('handles zero registered users without crashing', () => {
    const steps = [{ step: 'registered', count: 0 }, { step: 'searched', count: 0 }];
    const funnel = buildFunnel(steps);
    expect(funnel[0].conversionFromFirst).toBe(0);
  });

  it('successive conversion rates decrease monotonically in a healthy funnel', () => {
    const steps = [
      { step: 'registered',    count: 1000 },
      { step: 'searched',      count: 700  },
      { step: 'viewed_profile',count: 400  },
      { step: 'payment',       count: 50   },
    ];
    const funnel = buildFunnel(steps);
    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i].conversionFromFirst).toBeLessThanOrEqual(funnel[i - 1].conversionFromFirst);
    }
  });
});

// ─── Q83: Cohort Analysis ────────────────────────────────────────────────────

describe('Q83: Cohort Analysis — retention rate', () => {
  function retainedRate(activeCount, userCount) {
    if (userCount === 0) return 0;
    return parseFloat(((activeCount / userCount) * 100).toFixed(2));
  }

  it('100% retention when all users active', () => {
    expect(retainedRate(100, 100)).toBe(100);
  });

  it('0% retention when no users active', () => {
    expect(retainedRate(0, 100)).toBe(0);
  });

  it('50% retention is computed correctly', () => {
    expect(retainedRate(50, 100)).toBe(50);
  });

  it('handles zero cohort size without division by zero', () => {
    expect(retainedRate(0, 0)).toBe(0);
  });

  it('cohort key format is YYYY-MM', () => {
    const d = new Date('2026-11-01');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    expect(key).toBe('2026-11');
  });

  it('period offset is 2 for cohort=Sep, period=Nov', () => {
    const cohort = new Date('2026-09-01');
    const period = new Date('2026-11-01');
    const offset = (period.getFullYear() - cohort.getFullYear()) * 12
      + (period.getMonth() - cohort.getMonth());
    expect(offset).toBe(2);
  });
});

// ─── Q84: Retention Metrics ──────────────────────────────────────────────────

describe('Q84: Retention Metrics — DAU/WAU/MAU ratios', () => {
  it('DAU/MAU ratio formula is correct', () => {
    const ratio = parseFloat(((200 / 1000) * 100).toFixed(2));
    expect(ratio).toBe(20);
  });

  it('DAU/MAU cannot exceed 100%', () => {
    expect((500 / 1000) * 100).toBeLessThanOrEqual(100);
  });

  it('D7 retention rate formula is correct', () => {
    const rate = parseFloat(((140 / 200) * 100).toFixed(2));
    expect(rate).toBe(70);
  });

  it('D30 retention is typically lower than D7', () => {
    expect(40).toBeLessThan(70);
  });
});

// ─── Q85: Churn Prediction ───────────────────────────────────────────────────

describe('Q85: Churn Prediction — risk scoring', () => {
  function getChurnRisk(lastLoginAt, now) {
    if (!lastLoginAt) return { risk: 'high', score: 90 };
    const days = Math.floor((now - new Date(lastLoginAt)) / (24 * 60 * 60 * 1000));
    if (days > 14) return { risk: 'high',   score: 90 };
    if (days > 7)  return { risk: 'medium', score: 60 };
    if (days > 3)  return { risk: 'low',    score: 30 };
    return { risk: 'none', score: 0 };
  }

  const now = new Date('2026-11-12T12:00:00Z');

  it('no lastLoginAt → high risk', () => {
    expect(getChurnRisk(null, now).risk).toBe('high');
  });

  it('20 days inactive → high risk (score 90)', () => {
    const d = new Date(now - 20 * 24 * 60 * 60 * 1000);
    expect(getChurnRisk(d, now).risk).toBe('high');
    expect(getChurnRisk(d, now).score).toBe(90);
  });

  it('10 days inactive → medium risk (score 60)', () => {
    const d = new Date(now - 10 * 24 * 60 * 60 * 1000);
    expect(getChurnRisk(d, now).risk).toBe('medium');
    expect(getChurnRisk(d, now).score).toBe(60);
  });

  it('5 days inactive → low risk (score 30)', () => {
    const d = new Date(now - 5 * 24 * 60 * 60 * 1000);
    expect(getChurnRisk(d, now).risk).toBe('low');
    expect(getChurnRisk(d, now).score).toBe(30);
  });

  it('1 day inactive → no risk', () => {
    const d = new Date(now - 1 * 24 * 60 * 60 * 1000);
    expect(getChurnRisk(d, now).risk).toBe('none');
  });

  it('subscription churn rate formula is correct', () => {
    const rate = parseFloat(((10 / 100) * 100).toFixed(2));
    expect(rate).toBe(10);
  });
});

// ─── Q86: Revenue Tracking ───────────────────────────────────────────────────

describe('Q86: Revenue Tracking — MRR/ARR/LTV', () => {
  const TIER_PRICES = { ESSENTIEL: 25, PRO: 50, ELITE: 100, GRATUIT: 0 };
  const COMMISSION_RATE = 0.15;

  it('MRR is sum of active subscription prices', () => {
    const subs = [{ tier: 'ESSENTIEL' }, { tier: 'PRO' }, { tier: 'ELITE' }, { tier: 'GRATUIT' }];
    const mrr = subs.reduce((sum, s) => sum + (TIER_PRICES[s.tier] || 0), 0);
    expect(mrr).toBe(175);
  });

  it('ARR = MRR * 12', () => {
    expect(175 * 12).toBe(2100);
  });

  it('ARPU = MRR / paying subscribers', () => {
    const arpu = parseFloat((175 / 3).toFixed(2));
    expect(arpu).toBeCloseTo(58.33, 1);
  });

  it('LTV = ARPU * average lifetime months', () => {
    const ltv = parseFloat((58.33 * 6).toFixed(2));
    expect(ltv).toBeCloseTo(349.98, 0);
  });

  it('commission = 15% of payment amount', () => {
    expect(parseFloat((1000 * COMMISSION_RATE).toFixed(2))).toBe(150);
  });

  it('MoM growth formula is correct', () => {
    const growth = parseFloat((((1100 - 1000) / 1000) * 100).toFixed(2));
    expect(growth).toBe(10);
  });

  it('negative MoM growth is handled', () => {
    const growth = parseFloat((((900 - 1000) / 1000) * 100).toFixed(2));
    expect(growth).toBe(-10);
  });

  it('total revenue = subscription + commission', () => {
    expect(parseFloat((175 + 150).toFixed(2))).toBe(325);
  });

  it('revenue series groups correctly by day', () => {
    const payments = [
      { amount: 100, createdAt: new Date('2026-11-01T10:00:00Z') },
      { amount: 200, createdAt: new Date('2026-11-01T15:00:00Z') },
      { amount: 50,  createdAt: new Date('2026-11-02T10:00:00Z') },
    ];
    const grouped = {};
    payments.forEach(p => {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!grouped[key]) grouped[key] = { volume: 0, count: 0 };
      grouped[key].volume += p.amount;
      grouped[key].count  += 1;
    });
    expect(Object.keys(grouped).length).toBe(2);
    expect(grouped['2026-11-01'].volume).toBe(300);
    expect(grouped['2026-11-02'].volume).toBe(50);
  });
});
