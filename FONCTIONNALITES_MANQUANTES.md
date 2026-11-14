# 18 FONCTIONNALITÉS MANQUANTES POUR SCALE INTERNATIONAL

**Objectif:** Roadmap complète pour Series A + international  
**Effort Total:** ~336 heures (42 jours @ 1 dev)  
**Timeline:** Phase 1 (URGENT) 0h, Phase 2 (SHORT-TERM) 40h, Phase 3 (MEDIUM) 200h, Phase 4 (LONG) 96h

---

## PHASE 1: URGENT (0h — Blocker if missing)

**Aucun blocker identifié**

---

## PHASE 2: SHORT-TERM (40 heures, 1-2 sprints)

### 1. **KYC/AML Compliance** (16 heures)

**Contexte:** Régulations OHADA + EU MiFID II exigent vérification identité  
**Détail:**
- Intégration Veriff (liveness + OCR)
- Screening OFAC + liste sanctions
- DocuSign pour eSignature documents
- Audit trail compliance

**Estimation:**
- Veriff API integration: 8h
- OFAC screening + caching: 4h
- Testing + CI/CD: 4h

**Impact:** Series A blocker, perte de 80% de crédibilité sans KYC  
**Recommandation:** Faire avant 1k professionals

---

### 2. **API Rate Limiting & Quotas** (8 heures)

**Contexte:** Endpoints mal protégés, vulnérable aux DoS  
**Détail:**
- Redis-backed rate limiter per user/IP
- Quota tiers (free/pro/enterprise)
- Graceful degradation (429 + retry-after)

**Estimation:**
- Rate limiter middleware: 4h
- Quota engine + database: 2h
- Testing + monitoring: 2h

**Impact:** Security + stability critical

---

### 3. **Content Moderation Automation** (10 heures)

**Contexte:** Spam/abuse peut détruire réputation plateforme  
**Détail:**
- AWS Rekognition (images) + Comprehend (text)
- Auto-flag pornography, violence, hate speech
- Manual review queue avec priorités

**Estimation:**
- AWS integration: 6h
- Flag logic + queue: 2h
- Testing: 2h

**Impact:** Trust + legal compliance (GDPR Article 37 moderation requirements)

---

### 4. **Advanced Dispute Resolution** (6 heures)

**Contexte:** Chargeback rates trop hauts = GeniusPay shutdown  
**Détail:**
- 3-step escalation (mediation → arbitration → court)
- Evidence submission (chat, photos, proof)
- SLA tracking (24h response, 7d resolution)

**Estimation:**
- Dispute workflow: 4h
- Evidence system: 2h

**Impact:** Payment processor confidence + legal compliance

---

## PHASE 3: MEDIUM-TERM (200 heures, 5-6 sprints)

### 5. **Multi-Currency & Internationalization** (28 heures)

**Contexte:** MANAWA croît dans 5 pays → XOF/EUR/USD/NGN/GHS  
**Détail:**
- Currency conversion layer (OpenExchangeRates API)
- Price display in local currency
- Tax/VAT calculations per country
- i18n for UI (fr/en/pt/ar)

**Estimation:**
- Conversion engine: 10h
- Tax calculation: 8h
- UI i18n: 10h

**Impact:** Unlock 5-10x revenue in neighboring countries

---

### 6. **Mobile Offline Sync** (24 heures)

**Contexte:** Connectivité intermittente en Afrique de l'Ouest  
**Détail:**
- Conflict-free replicated data types (CRDT)
- Offline queue for mutations
- Automatic resolution on sync
- SQLite local cache

**Estimation:**
- CRDT library integration: 12h
- Sync protocol: 10h
- Testing: 2h

**Impact:** 30-40% DAU boost in low-connectivity regions

---

### 7. **WhatsApp/SMS Notifications** (20 heures)

**Contexte:** Push notifications → 5% open rate, SMS → 95% open rate  
**Détail:**
- Twilio SMS integration
- WhatsApp Business API (Twilio)
- Preference management (SMS vs push vs email)
- A/B testing framework for channels

**Estimation:**
- Twilio SMS: 8h
- WhatsApp integration: 8h
- Preferences + A/B: 4h

**Impact:** 15-20x engagement boost

---

### 8. **Professional Verification Video** (16 heures)

**Contexte:** Fake professionals = dead platform  
**Détail:**
- In-app video verification (Twilio Video)
- AI liveness detection (AWS Rekognition)
- Verification badge + timestamp
- Manual review fallback

**Estimation:**
- Video capture + submission: 8h
- Liveness detection + badge: 6h
- Review queue: 2h

**Impact:** Trust score +40%, scam rate -80%

---

### 9. **OAuth Integration (Google/Apple/Facebook)** (18 heures)

**Contexte:** Registration friction → 30% abandon  
**Détail:**
- Google Sign-In
- Apple Sign-In
- Facebook Login
- Account linking

**Estimation:**
- Google/Apple: 10h
- Facebook: 4h
- Account linking: 4h

**Impact:** Registration → 50% faster, conversion +15%

---

### 10. **Webhook Reliability & Retry** (12 heures)

**Contexte:** GeniusPay webhooks peuvent être manqués  
**Détail:**
- Exponential backoff (1s, 5s, 30s, 5m, 30m)
- Webhook signature verification (HMAC-SHA256)
- Dead letter queue after 5 retries
- Admin console for manual retry

**Estimation:**
- Retry engine: 6h
- Dead letter queue: 3h
- Admin UI: 3h

**Impact:** Payment success rate +2-3%

---

### 11. **Advanced Search Filters** (18 heures)

**Contexte:** MeiliSearch basique → users perdu dans résultats  
**Détail:**
- Faceted search (trade, city, rating, price, availability)
- Saved searches
- Search analytics (top queries, no-result queries)
- Sort options (relevance, rating, price, distance)

**Estimation:**
- Facet indexing: 8h
- Advanced filters: 6h
- Analytics: 4h

**Impact:** Search conversion +25-30%

---

### 12. **Subscription & Recurring Billing** (24 heures)

**Contexte:** SaaS model pour pros = recurring revenue  
**Détail:**
- Monthly/yearly subscription tiers
- Feature-gated by tier (priority, featured listing, analytics)
- Auto-renewal + cancellation
- Stripe integration pour billing

**Estimation:**
- Subscription models: 8h
- Stripe recurring: 10h
- Admin cancellation UI: 6h

**Impact:** MRR 50-100k XOF from professionals

---

### 13. **Analytics Dashboard Completion** (20 heures)

**Contexte:** Routes existent, UI n'existe pas  
**Détail:**
- Professional analytics (bookings, revenue, ratings)
- Client analytics (saved favorites, searches, bookings)
- Admin analytics (GMV, DAU, retention, LTV)
- Export to PDF/CSV

**Estimation:**
- Professional dashboard: 8h
- Client dashboard: 6h
- Admin dashboard: 6h

**Impact:** Retention +15%, pro engagement +20%

---

## PHASE 4: LONG-TERM (96 heures, 2-3 mois)

### 14. **AI Matching Algorithm** (32 heures)

**Contexte:** Manual search → vs recommended matches  
**Détail:**
- Collaborative filtering (past bookings)
- Content-based filtering (tags, ratings, reviews)
- ML model training (TensorFlow.js)
- A/B test recommendations

**Estimation:**
- Data pipeline: 12h
- ML model: 14h
- A/B testing framework: 6h

**Impact:** Booking conversion +20-30%

---

### 15. **Referral Program & Gamification** (20 heures)

**Contexte:** Viral growth = most efficient acquisition  
**Détail:**
- Referral bonus tracking
- Referral links + tracking codes
- Leaderboard
- Achievement badges
- Social sharing

**Estimation:**
- Referral system: 10h
- Leaderboard + badges: 6h
- Social integration: 4h

**Impact:** DAU growth +40-60% with viral coefficient 1.2-1.5

---

### 16. **Advanced Admin Automation** (18 heures)

**Contexte:** Manual admin work = doesn't scale  
**Détail:**
- Auto-suspend on 3 disputes in 30 days
- Auto-feature top-rated professionals
- Automated dispute resolution (if evidence clear)
- Bulk actions (email, suspend, feature)

**Estimation:**
- Automation rules engine: 10h
- Bulk operations: 6h
- Testing: 2h

**Impact:** Ops team productivity +200%

---

### 17. **Invoice & Tax Reporting** (16 heures)

**Contexte:** Professionals need invoices + tax reports  
**Détail:**
- Auto-generated invoices
- Tax reports by month/quarter
- Integration with local tax authority APIs (if available)
- Export to accounting software (QuickBooks, etc)

**Estimation:**
- Invoice generation: 6h
- Tax calculations: 6h
- Export integrations: 4h

**Impact:** Pro retention +30%, compliance +100%

---

### 18. **Real-time Booking Map** (10 heures)

**Contexte:** "Where can I find help NOW?"  
**Détail:**
- Real-time availability map (Google Maps integration)
- Location filtering
- Distance-based sorting
- Live professional locations (with privacy controls)

**Estimation:**
- Google Maps API: 6h
- Real-time update via WebSocket: 4h

**Impact:** Urgent booking conversion +40%

---

## PRIORITÉ PAR IMPACT

| Rank | Feature | Impact | Effort | ROI |
|------|---------|--------|--------|-----|
| 1 | KYC/AML (feat 1) | Series A blocker | 16h | 10/10 |
| 2 | Multi-currency (feat 5) | 5-10x revenue | 28h | 9/10 |
| 3 | OAuth (feat 9) | Conversion +15% | 18h | 9/10 |
| 4 | WhatsApp/SMS (feat 7) | Engagement 15-20x | 20h | 9/10 |
| 5 | Referral program (feat 15) | DAU +40-60% | 20h | 8/10 |
| 6 | AI Matching (feat 14) | Booking +20-30% | 32h | 8/10 |
| 7 | Mobile offline (feat 6) | DAU +30-40% (low connectivity) | 24h | 8/10 |
| 8 | Advanced search (feat 11) | Search conversion +25% | 18h | 7/10 |
| 9 | Professional verification (feat 8) | Trust +40%, scams -80% | 16h | 8/10 |
| 10 | Subscription (feat 12) | MRR 50-100k | 24h | 8/10 |

---

## TIMELINE RECOMMANDÉ

### **NOW → 2 weeks (SHORT-TERM only):**
- KYC/AML (16h) — Series A prerequisite
- API Rate Limiting (8h) — Security critical
- Content Moderation (10h) — Legal compliance
- Advanced Disputes (6h) — Payment reliability

### **Weeks 3-8 (MEDIUM-TERM):**
- Multi-currency (28h) — Regional expansion
- Mobile offline (24h) — Connectivity resilience
- WhatsApp/SMS (20h) — Engagement boost
- OAuth (18h) — Conversion improvement
- Professional verification (16h) — Trust
- Advanced search (18h) — UX
- Subscription (24h) — Revenue
- Analytics completion (20h) — Insights
- Webhooks (12h) — Payment reliability

### **Months 3+ (LONG-TERM):**
- AI Matching (32h) — Product differentiation
- Referral program (20h) — Growth
- Admin automation (18h) — Ops efficiency
- Invoice/tax (16h) — Pro experience
- Real-time map (10h) — Urgent bookings

---

## EFFORT ALLOCATION (by person)

**1 Senior Backend Dev + 1 Junior Dev:**
- Week 1-2: KYC/AML + Rate limiting + Moderation (senior) → 34h
- Week 3-4: Multi-currency + OAuth + Search (senior) + Mobile offline (junior) → 66h
- Month 2: Rest of medium-term (split work)
- Month 3+: Long-term features

---

## FUNDING ROADMAP

| Phase | Cost (1 dev @ 80k XOF/month) | Outcome |
|-------|------|---------|
| Phase 1 (Urgent, done now) | 0 | Baseline |
| Phase 2 (SHORT, 1-2 sprints) | 60k XOF | Series A ready |
| Phase 3 (MEDIUM, 5-6 sprints) | 300k XOF | Regional scale |
| Phase 4 (LONG, 2-3 months) | 180k XOF | Product differentiation |
| **TOTAL** | **540k XOF (~$8,200 USD)** | Production-grade international platform |

---

## TECH DEBT PAYDOWN (concurrent)

- [ ] Fix float → decimal in schema (20h migration)
- [ ] Extract services layer from routes (40h)
- [ ] Add missing test coverage (20h)
- [ ] Remove connection-pool dead code (2h)
- [ ] Decompose index.js (6h)

---

## SUCCESS CRITERIA

✅ All 18 features implemented before Series A seed  
✅ KYC/AML compliance verified by legal  
✅ Multi-currency tested in 3 countries  
✅ Mobile offline tested on 2G networks  
✅ 80%+ test coverage maintained  
✅ Load tested to 10k DAU  

---

## NEXT STEP

1. **Approve SHORT-TERM (40h)** - do this week
2. **Hire 1 junior backend dev** - scale to 2x team
3. **Start Phase 2 sprint planning**
