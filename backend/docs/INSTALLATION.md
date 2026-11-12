# MANAWA API Documentation - Installation & Setup Guide

## Quick Installation

### Step 1: Install Dependencies

```bash
cd backend
npm install
```

This will install the required Swagger documentation packages:
- `swagger-ui-express` - Interactive UI
- `swagger-jsdoc` - JSDoc to OpenAPI converter
- `js-yaml` - YAML parsing

### Step 2: Start Server

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### Step 3: Access Documentation

Open your browser and visit:
- **Interactive Swagger UI**: http://localhost:3000/docs
- **JSON Specification**: http://localhost:3000/docs/swagger.json
- **YAML Specification**: http://localhost:3000/docs/openapi.yaml
- **Documentation Health**: http://localhost:3000/docs/health
- **API Statistics**: http://localhost:3000/docs/stats

## File Structure

```
backend/
├── docs/
│   ├── README.md                  # Main documentation guide
│   ├── INTEGRATION.md             # Integration guide with code examples
│   ├── ENDPOINTS.md               # Complete endpoint reference
│   ├── INSTALLATION.md            # This file
│   ├── swagger.js                 # Swagger/OpenAPI configuration (CORE)
│   ├── api-endpoints.js           # Endpoint definitions (CORE)
│   ├── schemas.js                 # Reusable schemas (CORE)
│   └── openapi.yaml               # OpenAPI 3.0 specification
├── routes/
│   ├── docs.js                    # Documentation routes (NEW)
│   ├── auth.js
│   ├── projects.js
│   └── ... (other route files)
├── index.js                       # Main app file (UPDATED)
├── package.json                   # Dependencies (UPDATED)
└── ... (other files)
```

## Verification

After installation, verify everything is working:

### 1. Check Server Status

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "ok"
}
```

### 2. Check Documentation

```bash
curl http://localhost:3000/docs/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "Documentation endpoints are operational",
  "endpoints": {
    "ui": "/docs",
    "swagger_json": "/docs/swagger.json",
    "openapi_json": "/docs/openapi.json",
    "openapi_yaml": "/docs/openapi.yaml"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 3. Get API Statistics

```bash
curl http://localhost:3000/docs/stats
```

Expected response includes endpoint counts and module breakdown.

## Troubleshooting

### Issue: "Cannot find module 'swagger-ui-express'"

**Solution**: Install dependencies
```bash
npm install
```

### Issue: Documentation not loading at /docs

**Solution**: Check if route is registered in index.js:
```javascript
const docsRoutes = require('./routes/docs');
app.use('/docs', docsRoutes);
```

Should be before other routes. Verify in index.js around line 220.

### Issue: Port 3000 already in use

**Solution**: Change port in .env or use:
```bash
PORT=3001 npm run dev
```

### Issue: CORS error when accessing docs

**Solution**: Ensure /docs is before CORS middleware in index.js

### Issue: Swagger UI loads but no endpoints shown

**Solution**: Check browser console for errors. Verify:
1. swagger.js is correctly configured
2. api-endpoints.js has proper JSDoc comments
3. Routes are properly mounted in index.js

## Configuration

### Environment Variables

Add to `.env` if needed:

```env
# Port
PORT=3000

# Node environment
NODE_ENV=development

# Swagger UI settings (optional)
SWAGGER_HOST=localhost:3000
SWAGGER_BASEPATH=/api
```

### Custom Settings

Edit `docs/swagger.js` to customize:

```javascript
// Change server URL
servers: [
  {
    url: 'https://your-domain.com/api',
    description: 'Production Server',
  }
]

// Add custom info
info: {
  title: 'Your API Title',
  version: '1.0.0',
  description: 'Your API description'
}
```

## Development Workflow

### Adding New Endpoint

1. Create route in `routes/newroute.js`:
```javascript
router.get('/example', (req, res) => {
  res.json({ message: 'Example endpoint' });
});
```

2. Add JSDoc comment:
```javascript
/**
 * @swagger
 * /example:
 *   get:
 *     summary: Get example
 *     tags: [Examples]
 *     responses:
 *       200:
 *         description: Success
 */
```

3. Register in `index.js`:
```javascript
app.use('/api/example', require('./routes/newroute'));
```

4. Documentation auto-updates on server restart

### Adding New Schema

1. Add to `docs/schemas.js`:
```javascript
NewSchema: {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' }
  }
}
```

2. Reference in endpoint docs:
```javascript
/**
 * @swagger
 * /example:
 *   get:
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NewSchema'
 */
```

## Testing Documentation

### Using Swagger UI

1. Open http://localhost:3000/docs
2. Click **Authorize** button
3. Paste your JWT token (format: `Bearer <token>`)
4. Click **Authorize**
5. Expand any endpoint and click **Try it out**
6. Fill in parameters and click **Execute**

### Using cURL

```bash
# Get JSON spec
curl http://localhost:3000/docs/swagger.json > spec.json

# Get YAML spec
curl http://localhost:3000/docs/openapi.yaml > spec.yaml
```

### Using Postman

1. Import JSON spec: http://localhost:3000/docs/swagger.json
2. Create environment variable `baseUrl = http://localhost:3000/api`
3. Create variable `token` with your JWT
4. Use in requests: `Authorization: Bearer {{token}}`

## Production Deployment

### Before Deploying

1. Set `NODE_ENV=production` in environment
2. Update `swagger.js` with production server URL:
```javascript
servers: [
  {
    url: 'https://api.manawa.app',
    description: 'Production Server',
  }
]
```

3. Test documentation endpoints
4. Verify all routes are properly documented

### Deployment Commands

```bash
# Build
npm install

# Run
npm start

# Test
curl https://api.manawa.app/docs/health
```

### Render Deployment

The documentation will be automatically available at:
```
https://<your-app>.onrender.com/docs
```

### Environment Setup

Add to Render environment:
```
PORT=3000
NODE_ENV=production
DATABASE_URL=<your-db>
JWT_SECRET=<your-secret>
```

## Performance Tips

1. **Cache Documentation**: Serve `/docs` through CDN
2. **Lazy Load Specs**: Swagger UI loads specs on demand
3. **Compress Responses**: Gzip enabled by default
4. **Rate Limit Docs**: Already rate-limited with other endpoints

## Security Considerations

1. **Token Required**: Use `Authorization: Bearer <token>` for protected endpoints
2. **No Secrets in Docs**: Never include API keys or secrets in documentation
3. **CORS Restricted**: Documentation follows CORS policy
4. **HTTPS Only**: Use HTTPS in production
5. **IP Whitelisting**: Can be restricted in Render settings

## Support & Resources

### Documentation Files

- `README.md` - Main guide and overview
- `INTEGRATION.md` - Integration examples and workflows
- `ENDPOINTS.md` - Complete endpoint reference
- `INSTALLATION.md` - This file
- `swagger.js` - OpenAPI configuration
- `api-endpoints.js` - Endpoint definitions
- `schemas.js` - Schema definitions

### Online Resources

- OpenAPI Spec: http://localhost:3000/docs/openapi.yaml
- Swagger UI: http://localhost:3000/docs
- API Health: http://localhost:3000/docs/health
- Statistics: http://localhost:3000/docs/stats

### Getting Help

1. Check documentation at `/docs`
2. Review INTEGRATION.md for examples
3. Check browser console for errors
4. Verify server logs: `npm run dev`
5. Restart server if changes made

## Updates & Maintenance

### Auto-Regeneration

Documentation automatically regenerates when:
- Server restarts
- `swagger.js` changes
- Route files change
- Schema definitions change

No manual build step required!

### Manual Regeneration

```bash
# Restart server
npm run dev

# Or in production
npm restart
```

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Start server: `npm run dev`
3. ✅ Open documentation: http://localhost:3000/docs
4. ✅ Test endpoints using Swagger UI
5. ✅ Review INTEGRATION.md for code examples
6. ✅ Deploy to production

---

For more details, visit the documentation at http://localhost:3000/docs
