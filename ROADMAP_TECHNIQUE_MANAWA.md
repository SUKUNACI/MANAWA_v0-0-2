# ROADMAP TECHNIQUE — 4 HORIZONS DE TRANSFORMATION

**Objectif:** De Production-Ready (2.8/5) → Enterprise-Grade (4.5+/5) en 12 mois

---

## A. URGENT (Weeks 1-4) — 14 hours

**🔴 CRITICAL FIXES TO UNBLOCK PRODUCTION**

1. Payment retry idempotency (1h)
2. requireRole array bug fix (0.5h)
3. Auth response data leaks (1h)
4. Hardcoded password rotation (0.5h)
5. Debug endpoint removal (0.5h)
6. Global rejection handlers (1h)
7. Brute force + webhook tests (9h)
8. Payment amount validation (1h)

**Impact:** Unblock production, eliminate security blockers
**Effort:** 14 hours (1 engineer, 2 weeks)

---

## B. SHORT-TERM (Weeks 5-12) — 72 hours

**🟠 HIGH-PRIORITY HARDENING**

1. Float → Decimal migration (20h)
2. Review race condition fix (2h)
3. Admin query pagination (3h)
4. Missing FK indexes (8h)
5. N+1 query fixes (12h)
6. Connection pool tuning (3h)
7. Payment transaction atomicity (4h)
8. Circuit breaker GeniusPay (3h)
9. Backup restoration testing (2h)
10. Auto-rollback implementation (4h)
11. Correlation ID middleware (2h)
12. Centralized logging (4h)
13. On-call setup (2h)
14. Rate limit tuning (2h)

**Impact:** SLA compliant, operational excellence
**Effort:** 72 hours (2 engineers, 4 weeks)

---

## C. MEDIUM-TERM (Months 3-6) — 3,020 hours

**🟠🟡 SERIES A FOUNDATION**

### MVP2-A (4 weeks — 640h)
- KYC/AML + Liveness (240h)
- GDPR Privacy (200h)
- Compliance Framework (200h)

### MVP2-B (4 weeks — 410h)
- Disputes & Complaints (200h)
- Content Moderation (180h)
- ABAC Permissions (180h)
- Trust Score (140h)
- Advanced Notifications (160h)

### MVP2-C (4 weeks — 760h)
- Internationalization (320h)
- Advanced Analytics (320h)
- Webhooks Advanced (120h)

### Series A-D (8 weeks — 1,360h)
- API Publiques (280h)
- Integrations (480h)
- Support System (200h)
- Marketplace Advanced (320h)
- Monitoring Advanced (160h)

**Impact:** Series A grade, marketplace complete
**Effort:** 3,020 hours (10-12 engineers, 12 weeks)

---

## D. LONG-TERM (Months 7-12+) — 1,480+ hours

**🟡 INTERNATIONAL SCALE**

1. ML/AI Features (600h+)
   - Recommendation engine
   - Churn prediction
   - Fraud detection (ML)
   - Price optimization
   - Search personalization

2. Advanced Compliance (160h)
   - ISO 27001 readiness
   - SOC2 audit prep
   - Tax documentation
   - Financial reporting (OHADA)

3. Multi-region Failover (240h)
   - Active/active setup
   - Geographic distribution
   - DNS failover

4. Zero-trust Architecture (320h)
   - Service-to-service auth
   - Encryption everywhere
   - Policy enforcement

**Impact:** International competitiveness, funding ready
**Effort:** 1,480+ hours (4-6 engineers, 12+ weeks)

---

## TOTAL EFFORT SUMMARY

| Phase | Hours | Team Size | Duration |
|-------|-------|-----------|----------|
| A (Urgent) | 14 | 1 engineer | 2 weeks |
| B (Short-term) | 72 | 2 engineers | 4 weeks |
| C (Medium-term) | 3,020 | 10-12 engineers | 12 weeks |
| D (Long-term) | 1,480+ | 4-6 engineers | 12+ weeks |
| **TOTAL** | **4,586** | **10-12 avg** | **6-12 months** |

---

## STAFFING PLAN

**Now → Week 2:**
- 1 senior engineer → Phase A fixes
- Team: Founder + 1 dev

**Week 3 → Month 3 (MVP2):**
- 10-12 engineers (full team)
- Structure: 3-4 teams working MVP2-A/B/C in parallel

**Month 4-6 (Series A):**
- 6-8 engineers (core team remains)
- Focus: API, integrations, support

**Month 7+ (Scale):**
- 4-6 engineers (skeleton)
- Focus: ML, compliance, multi-region

---

## FUNDING REQUIREMENTS

**Series A:** $2-4M (18-month runway)

**Breakdown:**
- Engineering team: $1.2-1.8M (10-12 people)
- Infrastructure/3ème-party: $200-300K/year
- Operations/support: $300-500K
- Buffer: $300-400K

---

## SUCCESS METRICS

| Horizon | KPI | Target |
|---------|-----|--------|
| Phase A | 0 CRITICAL issues | ✅ 0 by week 2 |
| Phase B | Uptime SLA | ✅ 99.5%+ by week 12 |
| Phase C | Test coverage | ✅ 85%+ by month 6 |
| Phase C | Security compliance | ✅ 75%+ (OWASP) by month 6 |
| Phase D | DAU capacity | ✅ 100k+ by month 12 |
| Phase D | Funding closed | ✅ Series A Q2 2027 |

---

## RISK MITIGATION

**Technical Risks:**
- Database migration: Staged rollout, validate data
- Payment system: GeniusPay dual-mode testing
- Auth: 2FA during transition, rollback ready

**Organizational Risks:**
- Team scaling: Hiring plan Q1 2027
- Knowledge transfer: Pair programming, documentation
- Burnout: Realistic timelines, no crunch mode

---

## DECISION POINTS

| Week | Decision | Options |
|------|----------|---------|
| W2 | Launch Phase A fixes | Go live or wait for Phase B? |
| W12 | MVP2 completion | Continue or extend? |
| M3 | Series A readiness | Raise now or polish 4 more weeks? |
| M6 | Expansion markets | Senegal only or parallel SEN+CI? |

---

## CONCLUSION

**Phased, achievable roadmap to Series A-grade backend in 6 months.**

Key: Start with hardening (Phase A), build foundation (MVP2), then scale (Series A/B).

Realistic staffing and funding match the scope.
