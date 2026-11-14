# AUDIT DE CYBERSÉCURITÉ — MANAWA BACKEND

**Date:** 14 novembre 2026  
**Scope:** C:\Users\HP\Desktop\MANAWA_NEW\backend  
**Coverage:** Authentication, Authorization, Data Protection, OWASP Top 10

---

## RÉSUMÉ EXÉCUTIF

**Posture de Sécurité:** 65/100 (Baseline satisfaisant, 14 findings à corriger)

### 🔴 CRITICAL (7 issues — MUST FIX)

1. **Hardcoded Admin Password** (routes/auth.js:502)
   - Password: `[REDACTED]` in source code
   - Severity: CRITICAL (git history compromise)
   - Fix: Use env var, force rotation NOW

2. **requireRole Array Bug** (14 route files)
   - `requireRole(['ADMIN'])` → `roles = [['ADMIN']]` → always 403
   - 14 admin routes permanently broken
   - Fix: Change to `requireRole('ADMIN')`

3. **Admin-Session Data Leak** (routes/auth.js:347-384)
   - Returns full user object incl. `passwordHash`, `twoFASecret`
   - Severity: CRITICAL (auth bypass)
   - Fix: Use explicit `select` on findUnique

4. **Login/Register Data Leak** (routes/auth.js:161, 98)
   - Leaks `twoFASecret`, `twoFABackupCodes`, OTP codes
   - Severity: CRITICAL (2FA bypass)
   - Fix: Add `select` filter, strip sensitive fields

5. **Payment Fraud Vector** (routes/payments.js:42-80)
   - User can override amount (charge 0.01 XOF for 100K quote)
   - Severity: CRITICAL (financial loss)
   - Fix: Validate amount vs quote amount

6. **CSRF Token Not Validated** (routes/auth.js:367, 429)
   - Token generated and set in cookie, never checked on requests
   - Severity: CRITICAL (XSS → CSRF)
   - Fix: Add CSRF validation middleware

7. **Debug Endpoint Exposes Schema** (routes/auth.js:452)
   - `GET /api/v1/auth/debug/check-columns` — unauthenticated
   - Returns database column info + partial error messages
   - Severity: CRITICAL (info disclosure)
   - Fix: DELETE endpoint immediately

### 🟠 HIGH (7 issues — SHOULD FIX)

1. **2FA Bypass** (routes/auth-2fa.js:152)
   - No rate limit on `/verify` endpoint
   - No validation of prior login session
   - Fix: Add rate limit (5 attempts/15min) + require twoFAToken

2. **Plaintext Password Reset** (routes/admin.js:257)
   - Admin password reset returns plaintext in JSON response
   - Fix: Generate reset token, send via email

3. **JWT Token in Response** (routes/auth.js:384, 406)
   - Token returned in JSON body (accessible by XSS)
   - Fix: Remove from response, use httpOnly cookie

4. **MeiliSearch Filter Injection** (routes/search-global.js:85, 91)
   - Unsanitized user input in filter strings
   - Fix: Escape special characters, whitelist values

5. **Error Messages Leak DB Details** (routes/admin.js — 23 places)
   - Returns raw `err.message` from Prisma
   - Fix: Log internally, return generic message to client

6. **SSRF in Webhooks** (routes/webhooks-admin.js:127)
   - Webhook URL not restricted to public IPs
   - Can hit internal services (169.254.169.254, localhost)
   - Fix: Block private IP ranges before registering

7. **Brute Force Disabled on Redis Fail** (middleware/bruteForceMiddleware.js:296)
   - Fails open if Redis unavailable
   - Fix: Fail closed with 503 on cache errors

---

## CHECKLIST OWASP TOP 10 2021

| Item | Status | Details |
|------|--------|---------|
| A01:Broken AC | 🔴 HIGH | IDOR/BOLA not systematically checked |
| A02:Crypto | ✅ OK | HTTPS/TLS enforced, bcryptjs OK |
| A03:Injection | 🟠 HIGH | SQL safe (Prisma), but MeiliSearch unsafe |
| A04:Insecure Design | 🔴 HIGH | CSRF not validated, no circuit breaker |
| A05:Config | 🟠 HIGH | Env vars OK, but secrets in code |
| A06:Components | ✅ OK | npm audit monitored, 5 low vulns |
| A07:Auth | 🔴 CRITICAL | 2FA bypass, plaintext resets, data leaks |
| A08:Data Integrity | 🟠 HIGH | No transaction atomicity, race conditions |
| A09:Logging | 🔴 HIGH | Errors leaked, no centralized logs |
| A10:SSRF | 🔴 HIGH | Webhooks + GeniusPay not validated |

---

## RECOMMENDATIONS BY SEVERITY

### IMMEDIATE (Today)

1. ✅ Rotate hardcoded admin password
2. ✅ Delete debug endpoint
3. ✅ Fix requireRole array bug (one-line fix × 14 files)

### THIS WEEK

4. Add global rejection handlers
5. Fix auth response data leaks
6. Validate payment amounts vs quotes
7. Add CSRF validation middleware
8. Implement 2FA rate limiting

### BEFORE SERIES A

9. Implement security test suite (brute force, webhooks)
10. Add centralized logging with sanitization
11. Setup security audit process
12. Implement incident response plan

---

## SECURITY MATURITY ROADMAP

| Horizon | Focus | Effort |
|---------|-------|--------|
| **Now** | Fix CRITICAL (7) + HIGH (7) | 30h |
| **Month 1** | OWASP + security testing | 60h |
| **Month 2** | KYC/AML + compliance | 240h |
| **Month 3-6** | Security architecture + incident response | 160h |

**Total: ~500 hours to Enterprise Security Grade**

---

## VERDICT

**Current:** 65/100 (AT-RISK)  
**After fixes:** 75/100 (ACCEPTABLE)  
**Series A target:** 85/100 (GOOD)

**Recommendation:** Fix all CRITICAL + HIGH issues before production launch (30 hours).
