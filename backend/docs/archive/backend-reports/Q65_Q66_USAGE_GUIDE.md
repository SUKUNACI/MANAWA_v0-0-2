# Q65 + Q66: Usage Guide & Quick Reference

## Quick Start

### 1. Install Dependencies
```bash
npm install meilisearch
```

### 2. Set Environment Variables
```env
# .env
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_API_KEY=masterKey
```

### 3. Start MeiliSearch (Docker)
```bash
docker run -p 7700:7700 getmeili/meilisearch:latest
```

### 4. Start Server
```bash
npm run dev
```

The server will:
- Initialize MeiliSearch on startup
- Create all indices with correct schema
- Schedule daily sync job (1 hour after startup)

---

## Q65: Using Filters in Search

### Basic Filtering (Professionals)

#### Find verified electricians with 4+ rating in Paris
```bash
curl "http://localhost:4000/api/v1/search?q=electrician&type=professionals&minRating=4&verifiedOnly=true&city=Paris"
```

#### Find packages between €100-500
```bash
curl "http://localhost:4000/api/v1/search?q=painting&type=packages&minPrice=100&maxPrice=500"
```

### Filter Format Options

**Option 1: Direct parameters**
```
GET /api/v1/search?q=plumber&minPrice=50&maxPrice=200&city=Paris
```

**Option 2: filters array**
```
GET /api/v1/search?q=plumber&filters[minPrice]=50&filters[maxPrice]=200&filters[city]=Paris
```

### Available Filters by Type

#### Professionals (`type=professionals`)
```
GET /api/v1/search?q=electrician&type=professionals&
  minRating=3&              # Min rating (0-5)
  maxRating=5&              # Max rating (0-5)
  minPrice=50&              # Min subscription price
  maxPrice=500&             # Max subscription price
  city=Paris&               # City name
  verifiedOnly=true         # Only verified professionals
```

#### Packages (`type=packages`)
```
GET /api/v1/search?q=installation&type=packages&
  minPrice=50&              # Min package price
  maxPrice=500&             # Max package price
  verifiedOnly=true&        # Only verified professionals' packages
  category=electrical       # Package category
```

#### Portfolio (`type=portfolio`)
```
GET /api/v1/search?q=bathroom&type=portfolio&
  city=Paris&               # Professional's city
  category=bathroom         # Project category
```

#### Projects (`type=projects`)
```
GET /api/v1/search?q=renovation&type=projects&
  city=Paris&               # Project location
  minBudget=1000&           # Min budget
  maxBudget=5000&           # Max budget
  category=renovation       # Project category
```

### Response with Filters

```json
{
  "query": "electrician",
  "filters": {
    "minRating": "4",
    "city": "Paris",
    "verifiedOnly": "true"
  },
  "professionals": [
    {
      "id": "pro_123",
      "firstName": "Jean",
      "lastName": "Dupont",
      "trade": "Electrician",
      "averageRating": 4.8,
      "verifiedByAdmin": true,
      "city": "Paris",
      "companyName": "Electrical Solutions"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 24,
    "totalPages": 5
  }
}
```

---

## Q66: Global Full-Text Search via MeiliSearch

### Basic Global Search

```bash
# Search across all indices
curl "http://localhost:4000/api/v1/search/global?q=electrician"
```

### Global Search with Filters (Q65 + Q66)

```bash
# Search all indices with filters
curl "http://localhost:4000/api/v1/search/global?q=electrician&minRating=4&city=Paris&limit=10&offset=0"
```

### Search Specific Indices

```bash
# Professionals only
curl "http://localhost:4000/api/v1/search/global/professionals?q=electrician&minRating=4"

# Packages only
curl "http://localhost:4000/api/v1/search/global/packages?q=installation&minPrice=50&maxPrice=500"

# Portfolio only
curl "http://localhost:4000/api/v1/search/global/portfolio?q=bathroom&city=Paris"
```

### Response Format (Global)

```json
{
  "query": "electrician",
  "filters": {},
  "pagination": {
    "limit": 10,
    "offset": 0
  },
  "results": {
    "professionals": {
      "hits": [
        {
          "id": "pro_123",
          "firstName": "Jean",
          "lastName": "Dupont",
          "trade": "Electrician",
          "averageRating": 4.8,
          "verifiedByAdmin": true
        }
      ],
      "processingTimeMs": 12
    },
    "projects": {
      "hits": [],
      "processingTimeMs": 5
    },
    "portfolio": {
      "hits": [],
      "processingTimeMs": 4
    },
    "packages": {
      "hits": [],
      "processingTimeMs": 6
    },
    "reviews": {
      "hits": [],
      "processingTimeMs": 3
    }
  },
  "total": 1
}
```

---

## Advanced Usage Examples

### 1. Find Verified Specialists in Your City

```javascript
// Frontend example
const city = 'Paris';
const minRating = 4.5;

fetch(`/api/v1/search?q=plumber&type=professionals&city=${city}&minRating=${minRating}&verifiedOnly=true`)
  .then(res => res.json())
  .then(data => {
    console.log(`Found ${data.pagination.total} verified plumbers in ${city}`);
    data.professionals.forEach(pro => {
      console.log(`${pro.firstName} ${pro.lastName} (Rating: ${pro.averageRating})`);
    });
  });
```

### 2. Price Range Filter (Packages)

```javascript
// Find affordable packages in a range
const searchAffordablePackages = (minPrice, maxPrice, category) => {
  const params = new URLSearchParams({
    q: category,
    type: 'packages',
    minPrice,
    maxPrice,
    limit: 20
  });
  
  return fetch(`/api/v1/search?${params}`);
};

searchAffordablePackages(100, 500, 'installation')
  .then(res => res.json())
  .then(data => console.log(data.packages));
```

### 3. Combined Global Search with Filters

```javascript
// Search everything for "electrical work"
const globalSearch = async (query, filters = {}) => {
  const params = new URLSearchParams({ q: query, ...filters });
  
  const response = await fetch(`/api/v1/search/global?${params}`);
  const data = await response.json();
  
  return {
    professionals: data.results.professionals.hits,
    packages: data.results.packages.hits,
    portfolio: data.results.portfolio.hits,
    projects: data.results.projects.hits,
    reviews: data.results.reviews.hits,
  };
};

const results = await globalSearch('electrical installation', {
  minPrice: 100,
  maxPrice: 1000,
  city: 'Paris'
});
```

### 4. Pagination

```bash
# Page 1: limit=10, offset=0
curl "http://localhost:4000/api/v1/search/global?q=electrician&limit=10&offset=0"

# Page 2: limit=10, offset=10
curl "http://localhost:4000/api/v1/search/global?q=electrician&limit=10&offset=10"

# Page 3: limit=10, offset=20
curl "http://localhost:4000/api/v1/search/global?q=electrician&limit=10&offset=20"
```

---

## Common Use Cases

### Use Case 1: Customer Looking for a Professional

**Client request**:
- Search: "electrician" in Paris
- Filters: Rating ≥ 4.0, Verified only

**Query**:
```
GET /api/v1/search?q=electrician&type=professionals&city=Paris&minRating=4&verifiedOnly=true
```

### Use Case 2: Browse Service Packages

**Client request**:
- Search: "electrical installation"
- Budget: €50-€300
- Sort by price

**Query**:
```
GET /api/v1/search?q=electrical&type=packages&minPrice=50&maxPrice=300&limit=20
```

### Use Case 3: Discover Portfolio Examples

**Client request**:
- Search: "bathroom renovation" 
- In: Paris, Marseille, Lyon
- From verified professionals

**Query** (multiple searches):
```
GET /api/v1/search/global/portfolio?q=bathroom&city=Paris
GET /api/v1/search/global/portfolio?q=bathroom&city=Marseille
GET /api/v1/search/global/portfolio?q=bathroom&city=Lyon
```

### Use Case 4: Professional Browsing Their Reviews

**Query**:
```
GET /api/v1/search?q=excellent&type=reviews&minRating=4
```

---

## Performance Tips

### 1. Use Specific Indices
Instead of:
```
GET /api/v1/search/global?q=electrician  # Searches 5 indices
```

Use:
```
GET /api/v1/search/global/professionals?q=electrician  # Searches 1 index
```

**Impact**: ~4x faster response

### 2. Limit Results
```
GET /api/v1/search?q=electrician&limit=10  # vs default limit=20
```

**Impact**: Smaller payload, faster transfers

### 3. Use Appropriate Filters
```
# Good - specific filter
GET /api/v1/search?q=electrician&type=professionals&city=Paris

# Bad - search all then filter (client-side)
GET /api/v1/search?q=electrician&type=professionals
// then filter by city in code
```

### 4. Batch Requests
```javascript
// Good: Fetch multiple searches in parallel
Promise.all([
  fetch('/api/v1/search/global/professionals?q=electrician'),
  fetch('/api/v1/search/global/packages?q=installation'),
])

// Bad: Sequential requests
await fetch('/api/v1/search/global/professionals?q=electrician');
await fetch('/api/v1/search/global/packages?q=installation');
```

---

## Error Handling

### Invalid Filter Value
```bash
curl "http://localhost:4000/api/v1/search?q=electrician&minRating=10"
```

**Response**:
```json
{
  "error": "Filtres invalides",
  "details": [
    "Valeur invalide pour le filtre minRating: 10"
  ]
}
```

### Query Too Short
```bash
curl "http://localhost:4000/api/v1/search?q=a"
```

**Response**:
```json
{
  "error": "Le terme de recherche doit contenir au moins 2 caractères"
}
```

### MeiliSearch Unavailable
```json
{
  "error": "MeiliSearch service temporarily unavailable",
  "code": "SERVICE_UNAVAILABLE"
}
```

**Fallback**: Use GET `/api/v1/search` (database search) instead

---

## Rate Limiting

**Limit**: 100 requests per minute per user/IP

**Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1636200000
```

**When limit exceeded**:
```json
{
  "error": "Trop de requêtes de recherche, réessayez dans une minute"
}
```

---

## Monitoring & Debugging

### Check MeiliSearch Health
```bash
curl http://localhost:7700/health
```

```json
{
  "status": "available"
}
```

### View Index Stats (via MeiliSearch API)
```bash
curl http://localhost:7700/indexes/professionals/stats
```

### Monitor Sync Job
Check server logs:
```
[MeiliSearch] Synchronisation des professionnels... 
[MeiliSearch] Professionnels synchronisés (count: 1,234)
```

### Manual Re-sync
Restart server:
```bash
npm restart dev
```

This will trigger the sync job 1 hour after startup.

---

## Troubleshooting

### Problem: "MeiliSearch indisponible"
**Solution**: 
1. Check Docker container: `docker ps | grep meilisearch`
2. Verify URL: `echo $MEILISEARCH_URL`
3. Check API key: `echo $MEILISEARCH_API_KEY`
4. Restart MeiliSearch: `docker restart <container_id>`

### Problem: Indices Empty
**Solution**:
1. Wait 1 hour for initial sync
2. Check sync logs: `grep MeiliSearch logs`
3. Or restart server: `npm restart dev`

### Problem: Old Data in Search Results
**Solution**:
1. Manual sync (restart)
2. Or wait for next daily sync
3. Clear cache if using Redis

### Problem: "Filtre non autorisé"
**Solution**: Check FILTER_WHITELIST in `/utils/filter-helper.js`

---

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/search?q=&type=` | GET | Full-text search with filters (database) |
| `/api/v1/search?q=&type=&filters[]=` | GET | Search with Q65 filters (database) |
| `/api/v1/search/global?q=` | GET | Global search (MeiliSearch) |
| `/api/v1/search/global/professionals?q=` | GET | Professionals only (MeiliSearch) |
| `/api/v1/search/global/packages?q=` | GET | Packages only (MeiliSearch) |
| `/api/v1/search/global/portfolio?q=` | GET | Portfolio only (MeiliSearch) |

---

## Support

For issues or questions:
1. Check logs: `tail -f logs/app.log`
2. Check MeiliSearch: `docker logs <meilisearch_container>`
3. See documentation: `Q65_Q66_IMPLEMENTATION.md`

