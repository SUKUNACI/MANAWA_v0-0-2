# Testing Documentation Manifest

## Files Created (2026-11-18)

### 1. TESTING_INDEX.md
- **Type:** Navigation guide
- **Size:** ~6KB
- **Purpose:** Entry point for all testing documentation
- **Start here:** First document to read
- **Contains:** Quick links, reference, testing checklists

### 2. SERVICES_TEST_SUMMARY.json
- **Type:** Structured data (JSON)
- **Size:** ~11KB
- **Purpose:** Compact reference for all services
- **Machine-readable:** Yes (suitable for CI/CD)
- **Contains:** Configuration, routes, test approaches, production status

### 3. SERVICES_TESTING_README.md
- **Type:** Markdown guide
- **Size:** ~10KB
- **Purpose:** Complete testing and implementation guide
- **Audience:** Developers, QA, DevOps
- **Contains:** Quick start, procedures, troubleshooting, monitoring

### 4. BACKEND_SERVICES_TEST_GUIDE.md
- **Type:** Markdown procedures
- **Size:** ~16KB
- **Purpose:** Step-by-step testing procedures
- **Audience:** QA engineers, implementation teams
- **Contains:** Detailed test procedures, examples, error handling

### 5. SERVICES_ARCHITECTURE.md
- **Type:** Markdown with diagrams
- **Size:** ~22KB
- **Purpose:** System architecture documentation
- **Audience:** Architects, senior developers
- **Contains:** Visual diagrams, layer descriptions, data flows

### 6. EXTERNAL_SERVICES_INVENTORY.json
- **Type:** Comprehensive JSON
- **Size:** ~21KB
- **Purpose:** Deep reference document
- **Machine-readable:** Yes
- **Contains:** Detailed configurations, indices, settings, recommendations

### 7. test-external-services.js
- **Type:** Executable Node.js script
- **Size:** ~6KB
- **Purpose:** Automated service testing
- **Executable:** Yes (./test-external-services.js)
- **Output:** Color-coded terminal report
- **Exit codes:** 0 (pass), 1 (fail)

### 8. SERVICES_INVENTORY.json
- **Type:** JSON (legacy)
- **Size:** ~13KB
- **Purpose:** Reference (superseded by SERVICES_TEST_SUMMARY.json)
- **Status:** Deprecated, kept for reference

---

## Total Documentation

- **Files:** 7 (hors ce manifest)
- **Total Size:** ~99KB
- **Formats:** 3x Markdown, 3x JSON, 1x JavaScript
- **Audience:** Developers, QA, DevOps, Architects
- **Coverage:** 100% of external services

---

## Quick Access

| Need | File | Command |
|------|------|---------|
| Overview | TESTING_INDEX.md | `cat TESTING_INDEX.md` |
| Reference | SERVICES_TEST_SUMMARY.json | `cat SERVICES_TEST_SUMMARY.json` |
| Guide | SERVICES_TESTING_README.md | `cat SERVICES_TESTING_README.md` |
| Procedures | BACKEND_SERVICES_TEST_GUIDE.md | `cat BACKEND_SERVICES_TEST_GUIDE.md` |
| Architecture | SERVICES_ARCHITECTURE.md | `cat SERVICES_ARCHITECTURE.md` |
| Details | EXTERNAL_SERVICES_INVENTORY.json | `cat EXTERNAL_SERVICES_INVENTORY.json` |
| Auto-test | test-external-services.js | `node test-external-services.js` |
| Manifest | MANIFEST.md | `cat MANIFEST.md` |

---

## Services Covered

1. ✅ PostgreSQL/Neon (Database)
2. ✅ Redis/Upstash (Cache)
3. ✅ Bull Queues (Job processing)
4. ✅ Mailjet (Email)
5. ✅ Twilio (SMS)
6. ✅ Firebase FCM (Push notifications)
7. ✅ Sentry (Error tracking)

> **Note :** MeiliSearch a été retiré du projet en v0.0.2 (commit `3b386a9`). La recherche
> full-text est assurée directement par PostgreSQL (ILIKE / full-text search).
> Le fichier `config/meilisearch.js` n'existe plus.

---

## Testing Status

- **All services:** Testable without data modification ✅
- **Automated script:** Ready to run ✅
- **Documentation:** Complete ✅
- **Risk assessment:** None (read-only tests) ✅
- **Production ready:** Yes ✅

---

## Usage Timeline

### 5 Minutes
- Run automated test: `node test-external-services.js`
- Check health: `curl https://manawa-v0-0-2.onrender.com/api/v1/health`

### 15 Minutes
- Read: TESTING_INDEX.md
- Read: SERVICES_TESTING_README.md (overview)

### 30 Minutes
- Read: SERVICES_ARCHITECTURE.md
- Run: `node test-external-services.js --verbose`

### 1 Hour
- Read: All markdown files
- Run: All test commands from guides

### Full Depth
- Read: All files in order
- Study: Detailed architecture
- Understand: All service interactions

---

## Maintenance

Last updated: 2026-11-18  
Next review: 2026-12-18 (1 month)

Check annually for:
- New services added
- Configuration changes
- Updated API routes
- Changed dependencies
- Test procedure updates

---

End of Manifest
