# Q67 + Q68: Faceted Search & Aggregation Analytics

## Overview

Implémentation complète de deux features critiques pour le backend MANAWA:

- **Q67: Faceted Search** - Retourne les counts agrégés par dimensions (location, trade, rating, priceRange)
- **Q68: Aggregations** - Distribution stats et price distribution analytics

## Architecture

### Files Created

```
/utils/aggregation-helper.js           # Core aggregation functions
/routes/search-facets.js               # Q67: Faceted search endpoints
/routes/analytics-distribution.js      # Q68: Distribution & aggregation endpoints
/tests/q67-q68-routes.test.js          # Unit & integration tests
```

### Updated Files

```
/index.js                               # Registered new routes
```

---

## Q67: Faceted Search

### Purpose

Fournir des counts agrégés pour permettre aux clients de construire des filtres dynamiques dans l'UI.

Support des filtres combinés: `?city=Dakar&trade=Electricité&minRating=3&maxRating=5`

### Endpoints

#### GET /api/v1/search/facets
**Description**: Retourne tous les facets (locations, trades, ratings, priceRanges)

**Query Parameters**:
- `q` (optional) - Search query string, max 100 chars
- `city` (optional) - Filter by city, max 50 chars
- `trade` (optional) - Filter by trade, max 100 chars
- `minRating` (optional) - Min rating 0-5 (default: 0)
- `maxRating` (optional) - Max rating 0-5 (default: 5)
- `minPrice` (optional) - Min hourly rate (default: 0)
- `maxPrice` (optional) - Max hourly rate (default: 100000)

**Example Request**:
```bash
curl "http://localhost:4000/api/v1/search/facets?q=plomberie&city=Dakar&minRating=3"
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "facets": {
      "locations": {
        "Dakar": 45,
        "Casablanca": 32,
        "Abidjan": 18
      },
      "trades": {
        "Plomberie": 67,
        "Électricité": 45,
        "Menuiserie": 28
      },
      "ratings": {
        "0": 5,
        "1": 8,
        "2": 12,
        "3": 25,
        "4": 35,
        "5": 55
      },
      "priceRanges": {
        "under-50": 12,
        "50-100": 45,
        "100-200": 35,
        "200-500": 18,
        "over-500": 2
      },
      "total": 112
    },
    "appliedFilters": {
      "query": "plomberie",
      "city": "Dakar",
      "trade": null,
      "ratingRange": [3, 5],
      "priceRange": [0, 100000]
    },
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

**Status Codes**:
- `200` - Success
- `400` - Invalid parameters (rating range, price range, etc.)

---

#### POST /api/v1/search/facets/combined
**Description**: Faceted search with combined filters in request body

**Query Parameters**:
- `q` (optional) - Search query string

**Request Body**:
```json
{
  "filters": {
    "city": "Dakar",
    "trade": "Plomberie",
    "minRating": 3,
    "maxRating": 5,
    "minPrice": 50,
    "maxPrice": 200
  }
}
```

**Response**: Same as `/api/v1/search/facets`

---

#### GET /api/v1/search/facets/locations
**Description**: Returns location facets only (optimized endpoint)

**Response**:
```json
{
  "success": true,
  "data": {
    "locations": {
      "Dakar": 45,
      "Casablanca": 32
    },
    "total": 112,
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/search/facets/trades
**Description**: Returns trade facets only

**Response**:
```json
{
  "success": true,
  "data": {
    "trades": {
      "Plomberie": 67,
      "Électricité": 45
    },
    "total": 112,
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/search/facets/ratings
**Description**: Returns rating distribution (0-5 stars)

**Response**:
```json
{
  "success": true,
  "data": {
    "ratings": {
      "0": 5,
      "1": 8,
      "2": 12,
      "3": 25,
      "4": 35,
      "5": 55
    },
    "total": 112,
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/search/facets/prices
**Description**: Returns price range distribution

**Response**:
```json
{
  "success": true,
  "data": {
    "priceRanges": {
      "under-50": 12,
      "50-100": 45,
      "100-200": 35,
      "200-500": 18,
      "over-500": 2
    },
    "total": 112,
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

## Q68: Aggregation Analytics

### Purpose

Fournir des statistiques et distributions détaillées pour:
- Analytics dashboard (admin)
- Market analysis
- Price distribution insights
- Review/rating analysis
- Quote & booking metrics

### Endpoints

#### GET /api/v1/analytics/distribution
**Description**: Full distribution statistics by trade, location, verification status, subscription tier

**Query Parameters**:
- `startDate` (optional) - ISO8601 format, filter by creation date
- `endDate` (optional) - ISO8601 format

**Example Response**:
```json
{
  "success": true,
  "data": {
    "distribution": {
      "byTrade": [
        { "trade": "Plomberie", "count": 156 },
        { "trade": "Électricité", "count": 142 }
      ],
      "byLocation": [
        { "location": "Dakar", "count": 215 },
        { "location": "Casablanca", "count": 198 }
      ],
      "byVerification": [
        { "status": "Verified", "count": 189 },
        { "status": "Not Verified", "count": 224 }
      ],
      "bySubscription": [
        { "tier": "PRO", "count": 142 },
        { "tier": "ESSENTIEL", "count": 156 }
      ]
    },
    "appliedFilters": {
      "startDate": null,
      "endDate": null
    },
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/analytics/distribution/by-trade
**Description**: Distribution by trade only

**Response**:
```json
{
  "success": true,
  "data": {
    "byTrade": [
      { "trade": "Plomberie", "count": 156 },
      { "trade": "Électricité", "count": 142 },
      { "trade": "Menuiserie", "count": 98 }
    ],
    "total": 396,
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/analytics/distribution/by-location
**Description**: Distribution by location/city only

---

#### GET /api/v1/analytics/distribution/by-status
**Description**: Distribution by verification/identity status only

---

#### GET /api/v1/analytics/price-distribution
**Description**: Detailed price statistics and distribution buckets

**Example Response**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalProfessionals": 413,
      "professionalsWithRate": 389,
      "minPrice": 15.50,
      "maxPrice": 450.00,
      "meanPrice": 85.42,
      "medianPrice": 75.00,
      "percentile25": 45.00,
      "percentile75": 120.00,
      "percentile90": 180.00,
      "percentile95": 250.00,
      "standardDeviation": 65.32
    },
    "distribution": [
      {
        "priceRange": "0-30",
        "count": 45,
        "averageInRange": 22.50,
        "percentage": "10.89"
      },
      {
        "priceRange": "30-50",
        "count": 78,
        "averageInRange": 40.25,
        "percentage": "18.88"
      },
      {
        "priceRange": "50-75",
        "count": 95,
        "averageInRange": 62.50,
        "percentage": "22.99"
      },
      {
        "priceRange": "75-100",
        "count": 87,
        "averageInRange": 87.50,
        "percentage": "21.06"
      },
      {
        "priceRange": "100-150",
        "count": 56,
        "averageInRange": 125.00,
        "percentage": "13.56"
      },
      {
        "priceRange": "150-200",
        "count": 22,
        "averageInRange": 175.00,
        "percentage": "5.33"
      },
      {
        "priceRange": "200-300",
        "count": 18,
        "averageInRange": 250.00,
        "percentage": "4.36"
      },
      {
        "priceRange": "300+",
        "count": 12,
        "averageInRange": 380.00,
        "percentage": "2.90"
      }
    ],
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

**Statistical Measures Included**:
- `minPrice` - Lowest hourly rate
- `maxPrice` - Highest hourly rate
- `meanPrice` - Average price
- `medianPrice` - Median price (50th percentile)
- `percentile25` - 25th percentile (Q1)
- `percentile75` - 75th percentile (Q3)
- `percentile90` - 90th percentile
- `percentile95` - 95th percentile
- `standardDeviation` - Price variability

---

#### GET /api/v1/analytics/review-distribution
**Description**: Review and rating statistics by rating level and trade

**Example Response**:
```json
{
  "success": true,
  "data": {
    "ratingDistribution": [
      { "rating": 5, "count": 245, "percentage": 32.50 },
      { "rating": 4, "count": 189, "percentage": 25.10 },
      { "rating": 3, "count": 156, "percentage": 20.70 }
    ],
    "ratingByTrade": [
      {
        "trade": "Plomberie",
        "totalReviews": 145,
        "avgRating": 4.32,
        "minRating": 1,
        "maxRating": 5,
        "medianRating": 4.5
      }
    ],
    "topRated": [
      {
        "professionalId": "uuid",
        "userId": "uuid",
        "trade": "Plomberie",
        "rating": 4.95,
        "reviewCount": 47,
        "name": "Jean Martin",
        "city": "Dakar"
      }
    ],
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/analytics/quotes-bookings
**Description**: Quote and booking statistics including conversion rate

**Example Response**:
```json
{
  "success": true,
  "data": {
    "quotes": [
      {
        "status": "ACCEPTED",
        "count": 234,
        "avgAmount": 2450.50,
        "minAmount": 150.00,
        "maxAmount": 25000.00
      },
      {
        "status": "PENDING",
        "count": 89,
        "avgAmount": 1800.00,
        "minAmount": 200.00,
        "maxAmount": 15000.00
      },
      {
        "status": "REJECTED",
        "count": 45,
        "avgAmount": 1200.00,
        "minAmount": 100.00,
        "maxAmount": 8000.00
      }
    ],
    "bookings": [
      {
        "status": "COMPLETED",
        "count": 198
      },
      {
        "status": "IN_PROGRESS",
        "count": 34
      },
      {
        "status": "CANCELLED",
        "count": 8
      }
    ],
    "conversion": {
      "totalQuotes": 368,
      "totalBookings": 240,
      "conversionRate": 65.22
    },
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

#### GET /api/v1/analytics/health-check (ADMIN ONLY)
**Description**: Verify all aggregation queries are working

**Authentication**: Requires ADMIN role

**Response**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "aggregationQueries": {
      "distribution": {
        "status": "ok",
        "trades": 15,
        "locations": 8
      },
      "priceDistribution": {
        "status": "ok",
        "bucketsCount": 8
      },
      "reviewDistribution": {
        "status": "ok",
        "topRatedCount": 20
      },
      "quotesBookings": {
        "status": "ok",
        "quoteStatuses": 4,
        "bookingStatuses": 3
      }
    },
    "duration": "245ms",
    "timestamp": "2024-01-12T10:30:45.123Z"
  }
}
```

---

## Implementation Details

### aggregation-helper.js

Core utility functions using Prisma and raw SQL:

#### `getFacetedCounts(filters)`
- Retrieves all active professionals
- Computes facet counts by dimensions
- Applies search query filters
- Returns sorted results (by count, descending)

#### `getDistributionStats(filters)`
- Uses raw SQL with `$queryRaw` for complex aggregations
- Returns counts by trade, location, verification status, subscription

#### `getPriceDistributionStats()`
- Uses PostgreSQL `PERCENTILE_CONT` for statistical calculations
- Returns min, max, mean, median, quartiles, percentiles
- Includes histogram with 8 price range buckets

#### `getReviewDistributionStats()`
- Returns rating distribution (1-5)
- Rating breakdown by trade
- Top 20 rated professionals

#### `getQuoteBookingStats()`
- Quote statistics by status
- Booking statistics by status
- Quote-to-booking conversion rate

### Rate Limiting

All endpoints include rate limiting:
- **Window**: 60 seconds
- **Max**: 100 requests per minute
- **Key**: User ID (if authenticated) or IP address

### Error Handling

All endpoints include comprehensive error handling:
- Parameter validation via `express-validator`
- Try-catch blocks with detailed logging
- Proper HTTP status codes (400, 403, 404, 500)
- User-friendly error messages

---

## Database Queries

All aggregation queries use raw SQL (`$queryRaw`) for optimal performance:

```sql
-- Price distribution example
SELECT
  COUNT(*) as total_professionals,
  MIN(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as min_price,
  MAX(hourly_rate)::FLOAT as max_price,
  AVG(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as mean_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as median_price,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_25,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_75,
  STDDEV_POP(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as std_dev
FROM professional p
WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
```

---

## Testing

Tests are included in `/tests/q67-q68-routes.test.js`:

### Test Coverage

1. **Module Loading** - Verify routes and utilities load correctly
2. **Function Structure** - Verify expected properties and types
3. **Code Quality** - Verify endpoint names and correct patterns
4. **Route Exports** - Verify Express router export structure

### Running Tests

```bash
npm test -- tests/q67-q68-routes.test.js
```

**Expected Output**:
```
PASS  tests/q67-q68-routes.test.js
  Q67 + Q68: Aggregation Helper Functions
    getFacetedCounts
      ✓ should be a function
      ✓ should return facets object with expected structure
      ✓ should have ratings 0-5
      ✓ should have price ranges
    ... (18 tests total)
  
  Test Suites: 1 passed, 1 total
  Tests: 18 passed, 18 total
```

---

## Usage Examples

### Frontend: React Hook for Facets

```javascript
const useFacets = (filters) => {
  const [facets, setFacets] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchFacets = async () => {
      setLoading(true);
      const query = new URLSearchParams(filters).toString();
      const res = await fetch(`/api/v1/search/facets?${query}`);
      const data = await res.json();
      setFacets(data.data.facets);
      setLoading(false);
    };

    fetchFacets();
  }, [filters]);

  return { facets, loading };
};
```

### Admin Dashboard: Price Distribution Chart

```javascript
const PriceDistributionChart = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('/api/v1/analytics/price-distribution')
      .then(r => r.json())
      .then(data => setStats(data.data.summary));
  }, []);

  return stats && (
    <div>
      <p>Mean Price: ${stats.meanPrice.toFixed(2)}</p>
      <p>Median Price: ${stats.medianPrice.toFixed(2)}</p>
      <p>Price Range: ${stats.minPrice.toFixed(2)} - ${stats.maxPrice.toFixed(2)}</p>
    </div>
  );
};
```

---

## Performance Considerations

1. **Raw SQL Queries** - Uses optimized PostgreSQL aggregation functions
2. **Proper Indexing** - Requires indices on:
   - `professional.trade`
   - `professional.hourly_rate`
   - `professional.average_rating`
   - `user.city`
   - `user.deleted_at`

3. **Caching Potential** - Results can be cached with 1-hour TTL
4. **Pagination** - Not needed (these are aggregations, not listings)

---

## Migration Notes

- No database migrations required
- Uses existing Professional and User tables
- Compatible with PostgreSQL 12+
- No new tables created

---

## Status

✅ **Q67 Implementation**: Complete
- 6 faceted search endpoints
- Combined filter support
- Rate limiting
- Comprehensive validation

✅ **Q68 Implementation**: Complete
- 8 distribution/analytics endpoints
- Price statistics with percentiles
- Review analysis
- Quote/booking conversion metrics

✅ **Testing**: 18/18 tests passing
✅ **Documentation**: Complete

---

## Next Steps

1. Deploy to Render
2. Add caching layer (Redis) for high-traffic endpoints
3. Monitor performance and optimize if needed
4. Integrate with admin dashboard UI
5. Add frontend examples in mobile app
