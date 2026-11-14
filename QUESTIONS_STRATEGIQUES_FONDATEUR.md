# 40 QUESTIONS STRATÉGIQUES POUR LE FONDATEUR

**Objectif:** Décisions clés avant scale

---

## 1. SÉCURITÉ

**Q1:** Si base de données compromisée, process en &lt;4h?  
→ **Risque:** Amende GDPR 4% revenue + perte de confiance  
→ **Recommandation:** Incident Response Plan + insurance cyber 500k+  
→ **Décision par:** FONDATEUR + CISO (embauche?)

**Q2:** Assurance cybersecurity: couverture et montant?  
→ **Risque:** Incident = faillite sans assurance  
→ **Recommandation:** 1-2M EUR coverage, 250k franchise  
→ **Décision par:** FONDATEUR + CFO

**Q3:** Threat model complet (APT, ransomware, fraud)?  
→ **Risque:** Attaque non prévue = downtime  
→ **Recommandation:** Threat modeling STRIDE complet  
→ **Décision par:** FONDATEUR + CTO + CISO

**Q4:** Secret rotation process?  
→ **Risque:** Ancien dev avec ancien secret = accès non-autorisé  
→ **Recommandation:** HashiCorp Vault + rotation auto 30j  
→ **Décision par:** CTO

**Q5:** KYC/AML strategy?  
→ **Risque:** Sanction list miss = regulatory fine  
→ **Recommandation:** Veriff/IDnow liveness + OFAC screening  
→ **Décision par:** FONDATEUR + Legal

---

## 2. ARCHITECTURE

**Q6:** Monolith vs Microservices?  
→ **Risque:** Monolith trop longtemps = migration catastrophe  
→ **Recommandation:** Monolith 1-2 ans, extract services après 50k DAU  
→ **Décision par:** FONDATEUR + CTO

**Q7:** Multi-région dès aujourd'hui ou plus tard?  
→ **Risque:** Croissance rapide = transfer catastrophe  
→ **Recommandation:** Single region (Dakar/Abidjan) + backup EU  
→ **Décision par:** FONDATEUR + CTO

**Q8:** Database scaling path?  
→ **Risque:** DB lock à 50k DAU  
→ **Recommandation:** Supabase jusqu'à 10k, puis RDS  
→ **Décision par:** CTO + DevOps

**Q9:** Cache strategy?  
→ **Risque:** Redis single point of failure  
→ **Recommandation:** Redis centralisé + in-memory fallback  
→ **Décision par:** CTO

**Q10:** CDN + image strategy?  
→ **Risque:** Images = 80% bande passante  
→ **Recommandation:** Cloudflare CDN + WebP compression  
→ **Décision par:** CTO + DevOps

---

## 3. DONNÉES

**Q11:** RTO/RPO targets?  
→ **Risque:** DB crash = perte données?  
→ **Recommandation:** RTO 1h, RPO 15min (backups 15min + standby)  
→ **Décision par:** FONDATEUR + CTO

**Q12:** Data retention policy?  
→ **Risque:** Données inutiles = coûts croissants  
→ **Recommandation:** Transactions 7 ans (fiscal), users 3 ans  
→ **Décision par:** FONDATEUR + Legal

**Q13:** GDPR request volume estimée?  
→ **Risque:** Demandes non traitées = amende  
→ **Recommandation:** Internal process < 30j, auto-export option  
→ **Décision par:** FONDATEUR + Legal

**Q14:** PII anonymization timing?  
→ **Risque:** PII storage trop longtemps = breach risk  
→ **Recommandation:** Anonymize après 2 ans inactivité  
→ **Décision par:** FONDATEUR + Data team

**Q15:** Breach notification process?  
→ **Risque:** Mauvaise communication = perte de confiance  
→ **Recommandation:** Internal 2h → Customer 24h → Public 72h  
→ **Décision par:** FONDATEUR + Legal + CISO

---

## 4. PERFORMANCE

**Q16:** Acceptable response time?  
→ **Risque:** Lent = 50% bounce rate  
→ **Recommandation:** P95 listings 200ms, search 1s, checkout 500ms  
→ **Décision par:** Product + CTO

**Q17:** Load projections (DAU/mois)?  
→ **Risque:** Over/under infrastructure  
→ **Recommandation:** Scenario-based (1k/5k/20k DAU)  
→ **Décision par:** FONDATEUR + CTO

**Q18:** Endpoint priority if need to optimize?  
→ **Risque:** Optimise le mauvais endpoint  
→ **Recommandation:** Search → Listings → Checkout  
→ **Décision par:** FONDATEUR + Product

**Q19:** Observability budget?  
→ **Risque:** Logs pertes = aveugles aux bugs  
→ **Recommandation:** Full logs + 10% sampling traces  
→ **Décision par:** CTO + DevOps

---

## 5. EXPLOITATION

**Q20:** Team & on-call?  
→ **Risque:** CTO solo = burnout  
→ **Recommandation:** CTO + 1 junior DevOps dès 10k DAU  
→ **Décision par:** FONDATEUR

**Q21:** Incident SLA?  
→ **Risque:** Pas de SLA = personne repeat urgently  
→ **Recommandation:** Sev 1 &lt;1h, Sev 2 &lt;4h  
→ **Décision par:** FONDATEUR

**Q22:** Change management process?  
→ **Risque:** Bad deploy = catastrophe  
→ **Recommandation:** Code review → Staging → Canary → Full  
→ **Décision par:** CTO + DevOps

**Q23:** Auto-rollback si error spike?  
→ **Risque:** Bad deploy stuck for hours  
→ **Recommandation:** Auto-rollback if error rate &gt;5%  
→ **Décision par:** CTO + DevOps

---

## 6. ADMINISTRATION

**Q24:** Admin access levels?  
→ **Risque:** Trop d'access = disgruntled employee nukes data  
→ **Recommandation:** RBAC: founder (all), CS (mod), finance (reports)  
→ **Décision par:** FONDATEUR

**Q25:** Audit trail requirement?  
→ **Risque:** Fraude investigation = impossible  
→ **Recommandation:** Full audit trail (all admin changes)  
→ **Décision par:** FONDATEUR + Legal

**Q26:** Moderation team size?  
→ **Risque:** Spam reviews = platform pourrie  
→ **Recommandation:** CS part-time jusqu'à 5k listings, puis full-time moderator  
→ **Décision par:** FONDATEUR + Product

**Q27:** Dispute resolution (who decides)?  
→ **Risque:** Unfair bans = lawsuit  
→ **Recommandation:** Formal appeals process + 3ème-party arbitration  
→ **Décision par:** FONDATEUR + Legal

---

## 7. LOGIQUE MÉTIER

**Q28:** Booking confirmation immediate or professional approval?  
→ **Risque:** Auto-confirm = double-booking, approval = delays  
→ **Recommandation:** Auto-confirm + pro can cancel in 2h  
→ **Décision par:** FONDATEUR + Product

**Q29:** Payment split (deposit %)?  
→ **Risque:** Too low = flakes, too high = abandons  
→ **Recommandation:** 25% deposit (non-refundable &lt;24h) + 75% post  
→ **Décision par:** FONDATEUR + Product

**Q30:** Cancellation policy & risk holder?  
→ **Risque:** Unfair policy = reputation damage  
→ **Recommandation:** Free cancel &lt;24h, 50% fee &lt;12h, full charge &lt;2h  
→ **Décision par:** FONDATEUR

**Q31:** Review verification (who can review)?  
→ **Risque:** Fake reviews tank professionals  
→ **Recommandation:** Only verified transactions + auto-hide flagged  
→ **Décision par:** Product

**Q32:** Professional suspension criteria?  
→ **Risque:** Arbitrary = lawsuit risk  
→ **Recommandation:** Automated warning system (3.0 rating = probation)  
→ **Décision par:** FONDATEUR + Legal

**Q33:** Support channel (chat vs email vs phone)?  
→ **Risque:** No support = churn  
→ **Recommandation:** In-app chat + email backup, business hours initially  
→ **Décision par:** FONDATEUR + Product

---

## 8. PAIEMENTS

**Q34:** Chargeback liability?  
→ **Risque:** GeniusPay shutdowns at 1% chargebacks  
→ **Recommandation:** GeniusPay bears risk + MANAWA monitors  
→ **Décision par:** FONDATEUR + CFO

**Q35:** Escrow holding period?  
→ **Risque:** Escrow = pro cash flow hit, no escrow = fraud  
→ **Recommandation:** 3-7 day hold (standard)  
→ **Décision par:** FONDATEUR + CFO

**Q36:** Refund deadline?  
→ **Risque:** Too long = disputes chaos  
→ **Recommandation:** 30 day refund window + criteria-based auto-refund  
→ **Décision par:** FONDATEUR + Legal

**Q37:** Commission rate structure?  
→ **Risque:** Too high = pros migrate, too low = unsustainable  
→ **Recommandation:** 10% + 1 EUR fixed fee (scales)  
→ **Décision par:** FONDATEUR + CFO

**Q38:** Acceptable fraud rate?  
→ **Risque:** Chargeback &gt;1% = processor closure  
→ **Recommandation:** Target &lt;0.5%, alert at 1%  
→ **Décision par:** FONDATEUR + CFO

---

## 9. CONFORMITÉ

**Q39:** Applicable law (Senegal OHADA vs French)?  
→ **Risque:** Contrats invalides  
→ **Recommandation:** OHADA law + arbitration  
→ **Décision par:** FONDATEUR + Legal

**Q40:** Tax & VAT liability?  
→ **Risque:** Surprise tax bill = cash burn  
→ **Recommandation:** MANAWA collecte TVA, TDS payée  
→ **Décision par:** FONDATEUR + Accountant

---

## CRITICAL PATH (Decide Before MVP)

1. ✅ Booking logic (Q28-Q30)
2. ✅ Commission & payment (Q37)
3. ✅ Admin RBAC (Q24)
4. ✅ Change management (Q22)

## CRITICAL PATH (Decide Before Series A)

5. ✅ Incident response (Q20-Q23)
6. ✅ Cyber insurance (Q2)
7. ✅ RTO/RPO (Q11)
8. ✅ Expansion roadmap (Q6-Q7)

---

## NEXT STEP

**Schedule strategy session:**
- FONDATEUR + CTO + Product (2 hours)
- Work through Critical Path decisions
- Document assumptions
- Identify blockers
