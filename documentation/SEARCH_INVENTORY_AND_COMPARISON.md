# MANAWA Search Inventory & Architecture Comparison

**Purpose**: Inventory all search features, identify MeiliSearch dependencies, and recommend between two options: (A) Fix MeiliSearch storage/recovery or (B) Migrate to PostgreSQL-only.

**Requested by**: User analysis session (Nov 2026)

---

## 1. SEARCH FEATURES INVENTORY

### LOCAL SEARCH ROUTES (PostgreSQL Only)

| Route | What Users Search | DB Tables | Searchable Fields | Filters | MeiliSearch Dep | Status |
|-------|-------------------|-----------|------------------|---------|-----------------|--------|
| `GET /api/v1/search?type=professionals` | Professionals | professional | firstName, lastName, trade, trades, description, companyName, city | rating, reviewCount, verified, subscription | ❌ NO | ✅ Works |
| `GET /api/v1/search?type=portfolio` | Portfolio projects | portfolioProject | title, description, tradeCategory | (none) | ❌ NO | ✅ Works |
| `GET /api/v1/search?type=packages` | Service packages | servicePackage | title, description, category, professionalName | price range, category, verified | ❌ NO | ✅ Works |
| `GET /api/v1/search?type=all` | All 3 types | All above | All above | All above | ❌ NO | ✅ Works |
| `GET /api/v1/search/facets` | Facet counts | All | All | By filter | ❌ NO | ✅ Works |
| `POST /api/v1/search/facets/combined` | Advanced facets | All | All | By filter | ❌ NO | ✅ Works |

**Implementation**: `SearchModule` (search.js) uses only `prisma` + ILIKE queries. No MeiliSearch involved.

---

### GLOBAL SEARCH ROUTES (MeiliSearch Dependent)

| Route | What Users Search | MeiliSearch Indices | Implementation | Status |
|-------|-------------------|-------------------|-----------------|--------|
| `GET /api/v1/search/global?q=...` | All 5 types | professionals, projects, portfolio, packages, reviews | `SearchModule.searchGlobal()` → `globalSearch()` (MeiliSearch) | ❌ Indices missing |
| `GET /api/v1/search/global/professionals?q=...` | Professionals | professionals | `SearchModule.searchGlobalByType('professionals')` → MeiliSearch | ❌ Indices missing |
| `GET /api/v1/search/global/projects?q=...` | Projects | projects | Same as above | ❌ Indices missing |
| `GET /api/v1/search/global/portfolio?q=...` | Portfolio | portfolio | Same as above | ❌ Indices missing |
| `GET /api/v1/search/global/packages?q=...` | Packages | packages | Same as above | ❌ Indices missing |
| `GET /api/v1/search/global/reviews?q=...` | Reviews | reviews | Same as above | ❌ Indices missing |

**Implementation**: `SearchModule.searchGlobal()` and `searchGlobalByType()` call `globalSearch()` from `config/meilisearch.js`, which queries MeiliSearch client.

---

## 2. MeiliSearch INDEX DEFINITIONS

All 5 indices configured in `config/meilisearch.js`:

| Index Name | Source Table | Primary Key | Searchable Fields | Filterable Attributes | Sortable Attributes |
|------------|--------------|-------------|-------------------|----------------------|-------------------|
| professionals | professional | id | firstName, lastName, trade, trades, companyName, description, city | averageRating, reviewCount, verifiedByAdmin, city, subscription.tier, subscription.monthlyPrice | averageRating, reviewCount, createdAt |
| projects | project | id | title, description, location, category | budget, status, category, location | budget, createdAt, updatedAt |
| portfolio | portfolioProject | id | title, description, tradeCategory, professionalName, city | tradeCategory, city, verifiedByAdmin | createdAt |
| packages | servicePackage | id | title, description, category, professionalName | price, category, verifiedByAdmin | price, ordersCount, createdAt |
| reviews | review | id | comment, professionalName, authorName | rating, professionalId | rating, createdAt |

---

## 3. MeiliSearch FEATURES VS POSTGRESQL

### Features Provided by MeiliSearch (Currently Used)

1. **Full-text relevance ranking**: Scores results by relevance across indices
2. **Multi-index parallel search**: Queries 5 tables simultaneously in one request
3. **Built-in typo tolerance**: Fuzzy matching with configurable threshold
4. **Facet result caching**: Cached per-facet aggregation across indices
5. **Sub-millisecond latency**: Optimized for large result sets

### PostgreSQL Alternatives Available

| MeiliSearch Feature | PostgreSQL Equivalent | Trade-off |
|-------------------|---------------------|-----------|
| Full-text ranking | FTS (`to_tsvector` + `to_tsquery`) with weighted columns | Ranking less sophisticated than MeiliSearch |
| Multi-index parallel | UNION queries or `Promise.all()` + concurrent queries | ~100-200ms slower |
| Typo tolerance | Trigram similarity (`pg_trgm` extension) | Per-table only, not cross-index |
| Facet caching | Application-level cache (Redis/in-memory) | Less efficient than dedicated index |
| Sub-ms latency | GIN indices on FTS vectors | Won't reach sub-ms, but acceptable for MVP |

### Features Lost in PostgreSQL Migration

- **Cross-index typo tolerance**: Each table gets separate fuzzy matching (no cross-type fuzzy)
- **Relevance ranking sophistication**: PG FTS is simpler than MeiliSearch's ML-based ranking
- **Dedicated distributed cache**: App-level cache slower than MeiliSearch cache
- **Sub-millisecond latency**: PostgreSQL UNION queries will be ~100-200ms

---

## 4. DATA SYNC DEPENDENCY

All indices depend on daily batch sync:

| Entity | DB Table | MeiliSearch Index | Sync Job | Schedule | Auto-Update on DB Write |
|--------|----------|------------------|----------|----------|--------------------------|
| professionals | professional | professionals | `syncAllIndices()` → `syncProfessionals()` | Daily (24h) | ❌ NO |
| projects | project | projects | `syncAllIndices()` → `syncProjects()` | Daily (24h) | ❌ NO |
| portfolio | portfolioProject | portfolio | `syncAllIndices()` → `syncPortfolio()` | Daily (24h) | ❌ NO |
| packages | servicePackage | packages | `syncAllIndices()` → `syncPackages()` | Daily (24h) | ❌ NO |
| reviews | review | reviews | `syncAllIndices()` → `syncReviews()` | Daily (24h) | ❌ NO |

**Impact**: Updates to PostgreSQL won't appear in MeiliSearch until next sync (24h delay).

---

## 5. CURRENT PROBLEMS

### Problem 1: Index Creation Failed
- Bootstrap sync at 13:08-13:11Z failed (MeiliSearch was in cold start, returning HTML)
- Recovery sync at 13:11:10Z also failed
- **Result**: All 5 indices never created
- **Proof**: 13:21:15Z search queries returned `"Index 'professionals' not found"` (404)

### Problem 2: No Persistent Storage
- Render plan: **free**
- Storage: `./data.ms` (container-local, ephemeral)
- **Result**: Indices lost on any Render restart

### Problem 3: No Real-Time Sync
- Sync only runs daily (24h cron)
- DB updates take up to 24h to appear in search
- **Impact**: Search results stale until next sync

### Problem 4: No Data to Search
- All 5 indices created but **empty** (0 records)
- 0 professionals, projects, portfolio items, packages, reviews in DB
- **Impact**: Search returns `{"hits":[]}` even after successful sync

---

## 6. OPTION A: FIX MEILISEARCH (Keep Both Systems)

### Changes Required

#### 1. Index Creation (One-Time, 5 minutes)
- MeiliSearch is now responding in JSON (not HTML)
- Manually trigger `syncAllIndices()` OR wait for daily cron
- **How**: Call `POST /api/v1/admin/search/sync` or directly invoke sync function
- **Verification**: Verify indices exist: `curl -H "Authorization: Bearer $KEY" https://manawa-meilisearch.onrender.com/indexes`

#### 2. Persistent Storage (1-2 days)
- Upgrade Render MeiliSearch plan: `free` → `starter` or higher
- Configure persistent disk attachment to `/data.ms`
- **Cost**: ~$7-20/month minimum
- **Verification**: Verify indices survive Render restart

#### 3. Improve Cold-Start Recovery (Optional, 2 hours code change)
- Increase backend MeiliSearch client timeout: 2s → 10s
- Increase retry attempts during startup: 6 → 10
- **File**: `backend/config/meilisearch-recovery.js`
- **Verification**: Test MeiliSearch wake-up scenario

#### 4. Add Real-Time Sync (Optional, Future, 1 week)
- Add trigger on DB write → MeiliSearch sync
- Or reduce cron from 24h to 1h
- **Impact**: Search results fresher

### Pros
- ✅ Keeps optimized global search endpoint (`/search/global`)
- ✅ Typo tolerance works across all 5 indices
- ✅ Dedicated search service (separates concerns)
- ✅ Future-proof for scale (100M+ records benefit from MeiliSearch)
- ✅ Better relevance ranking than PostgreSQL FTS

### Cons
- ❌ Costs extra ($7-20/month minimum)
- ❌ Requires persistent storage setup on Render
- ❌ Adds operational complexity (2 systems to manage and monitor)
- ❌ Data still not synced automatically
- ❌ Doesn't solve "no documents" problem today
- ❌ Still dependent on cold-start reliability (proven fragile)

### Effort & Timeline
| Task | Effort | Duration |
|------|--------|----------|
| Trigger index creation | Minimal | 5 min |
| Add persistent storage | Small | 1-2 days |
| Improve cold-start (optional) | Small | 2 hours code |
| Add real-time sync (optional) | Medium | 1 week |
| **Total to production** | **Small** | **3-5 days** |

---

## 7. OPTION B: REMOVE MEILISEARCH, USE POSTGRESQL ONLY

### Changes Required

#### 1. Replace searchGlobal() with PostgreSQL UNION (3-4 days)
File: `backend/modules/search.js`

Replace:
```javascript
async searchGlobal(q, { limit = 10, offset = 0, filters = {} } = {}) {
  const results = await globalSearch(q, { limit, offset, filters });
  return { professionals: results.professionals, projects: results.projects, ... };
}
```

With:
```javascript
async searchGlobal(q, { limit = 10, offset = 0, filters = {} } = {}) {
  const results = await Promise.all([
    this.searchProfessionals(q, { skip: offset, take: limit, filters }),
    this.searchProjects(q, { skip: offset, take: limit, filters }),
    this.searchPortfolio(q, { skip: offset, take: limit, filters }),
    this.searchPackages(q, { skip: offset, take: limit, filters }),
    this.searchReviews(q, { skip: offset, take: limit, filters }),
  ]);
  
  return {
    professionals: results[0],
    projects: results[1],
    portfolio: results[2],
    packages: results[3],
    reviews: results[4],
  };
}
```

#### 2. Update Global Search Routes (1-2 days)
File: `backend/routes/search-global.js`
- Remove MeiliSearch recovery logic (lines 105-127, 129-144)
- Remove error handling for `MeiliSearch startup` and `MeiliSearch missing_index`
- Keep pagination and rate limiting as-is

#### 3. Add PostgreSQL FTS Optimization (Optional, 1 week)
- Create GIN indices: `CREATE INDEX ON table USING GIN(to_tsvector('french', column))`
- Create trigram indices: `CREATE INDEX ON table USING GIN(column gin_trgm_ops)`
- Replace ILIKE with FTS where appropriate

#### 4. Remove MeiliSearch Code (1-2 days)
Files to **delete**:
- `backend/config/meilisearch.js` (1500+ lines)
- `backend/config/meilisearch-recovery.js` (155 lines)
- `backend/jobs/meilisearch-sync.js` (356 lines)
- `backend/check-meilisearch.js`
- All MeiliSearch tests (7 test files)

Files to **modify**:
- `backend/index.js` - Remove MeiliSearch initialization + daily sync job
- `backend/.env.example` - Remove MEILISEARCH_URL, MEILISEARCH_API_KEY
- `backend/package.json` - Remove `meilisearch` dependency (if not used elsewhere)

#### 5. Decommission Render Service (30 min)
- Delete MeiliSearch service from Render dashboard
- Cancel MeiliSearch deployment

### Code Impact Summary
- **Files modified**: 7
- **Files deleted**: 11
- **Lines removed**: ~1500
- **Lines added**: ~200
- **Total change**: Net -1300 lines

### Pros
- ✅ Zero additional cost
- ✅ One system to operate (PostgreSQL already exists)
- ✅ No cold-start risk or Render dependency
- ✅ Search always works (uses same DB as rest of app)
- ✅ Can add real-time sync easily (trigger on DB write)
- ✅ All data already in PostgreSQL (Neon)
- ✅ Reduced operational burden

### Cons
- ❌ Slightly slower global search (~100-200ms slower, still acceptable)
- ❌ Typo tolerance per-table only (not cross-index fuzzy)
- ❌ Relevance ranking less sophisticated than MeiliSearch
- ❌ Won't scale as well for 100M+ records (but not concern today)
- ❌ Requires learning PostgreSQL FTS syntax

### Effort & Timeline
| Task | Effort | Duration |
|------|--------|----------|
| Replace searchGlobal() | Small | 3-4 days |
| Update routes | Small | 1-2 days |
| Add FTS optimization (optional) | Medium | 1 week |
| Remove MeiliSearch code | Small | 1-2 days |
| Tests + verification | Small | 3-5 days |
| **Total to production** | **Medium** | **2-3 weeks** |

---

## 8. SIDE-BY-SIDE COMPARISON

| Factor | Option A (MeiliSearch) | Option B (PostgreSQL) |
|--------|------|--------|
| **Monthly Cost** | +$7-20 | $0 |
| **Setup Time** | 3-5 days | 2-3 weeks |
| **Operational Complexity** | High (2 systems) | Low (1 system) |
| **Cold-Start Risk** | High (proven fragile) | None |
| **Search Latency** | Fast (~50ms) | Slower (~150-250ms) |
| **Typo Tolerance** | Excellent (5-index) | Good (per-table trigram) |
| **Relevance Ranking** | Excellent (ML-based) | Good (basic FTS) |
| **Real-Time Sync** | Manual job (24h) | Can be auto (trigger on write) |
| **Scalability (100M+ records)** | Excellent | Needs redesign |
| **Failure Mode** | Indices gone on restart | None (always works) |
| **Data Available Now?** | No (needs sync) | Yes (PostgreSQL) |
| **MVP Fit** | Over-engineered | Ideal |

---

## 9. RECOMMENDATION: **OPTION B (PostgreSQL Only)**

### Rationale

1. **No data exists today** → Both options return empty results anyway
2. **MeiliSearch proven fragile** → Cold-start failure already happened, ephemeral storage risk
3. **PostgreSQL already proven** → Local search endpoints work fine
4. **MANAWA is pre-MVP** → Don't optimize for 100M records with 0 data
5. **Cost-conscious startup** → $0 vs $7-20/month during bootstrap phase
6. **Operational simplicity** → One deployment, no Render service to maintain
7. **MVP sufficiency** → PostgreSQL FTS + UNION queries meet early user needs

### Trade-Offs Accepted

- **Slower global search**: ~100-200ms instead of ~50ms (acceptable, no users yet)
- **Reduced typo tolerance**: Per-table only, not cross-index (acceptable for MVP)
- **Less sophisticated ranking**: PostgreSQL FTS vs MeiliSearch ML (acceptable for MVP)

### Future Escape Hatch

If MANAWA reaches 1M+ records and global search becomes bottleneck, **re-add MeiliSearch later**. The architecture is proven and the code exists in git history. No lock-in decision.

---

## 10. IMPLEMENTATION PATH (Option B)

### Phase 1: Replace searchGlobal() (3-4 days)
1. Modify `modules/search.js`: Change `searchGlobal()` to execute 5 concurrent PostgreSQL queries
2. Modify `routes/search-global.js`: Remove MeiliSearch recovery logic
3. Test: Verify `/api/v1/search/global?q=test` returns empty but no errors

### Phase 2: Optimize (1 week, optional for MVP)
1. Add PG FTS indices on all searchable columns
2. Add trigram indices for typo tolerance
3. Replace ILIKE with FTS where beneficial
4. Profile queries, add indices where needed

### Phase 3: Remove MeiliSearch (1-2 days)
1. Delete MeiliSearch code files
2. Delete from Render dashboard
3. Update .env documentation

### Phase 4: Real-Time Sync (1 week, optional, future)
1. Add DB triggers or webhook on table updates
2. Or reduce cron interval from 24h to 1h
3. Verify search results update immediately

---

## 11. MINIMAL FIX (If Staying with MeiliSearch)

If you must use MeiliSearch (not recommended), minimal fixes to unblock:

1. **Trigger index creation** (5 minutes):
   ```bash
   # MeiliSearch is now awake, indices can be created
   curl -X POST https://manawa-v0-0-2.onrender.com/admin/meilisearch/sync
   ```

2. **Add persistent storage** (1-2 days):
   - Upgrade Render MeiliSearch plan
   - Attach persistent disk
   - Verify indices survive restart

3. **Increase cold-start timeout** (2 hours):
   - `config/meilisearch-recovery.js`: Change timeout 2s → 10s
   - Increase retry attempts: 6 → 10
   - Deploy + verify

That's it for MVP. Real-time sync is phase 2 (future).

---

## SUMMARY TABLE

| Dimension | Option A | Option B | Winner |
|-----------|----------|----------|--------|
| Cost | $$$ | $ | B |
| Setup time | Short | Medium | A |
| Operational burden | High | Low | B |
| Reliability | Fragile | Robust | B |
| MVP fit | No | Yes | B |
| Future flexibility | Locked-in | Easily re-add MeiliSearch | B |

**Final Verdict**: **Option B recommended** for MANAWA MVP. Switch to MeiliSearch at scale if needed.
