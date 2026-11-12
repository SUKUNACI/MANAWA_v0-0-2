require('dotenv').config();

// Validate required environment variables (skip in test mode)
if (process.env.NODE_ENV !== 'test') {
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'NODE_ENV',
    'MAILJET_API_KEY',
    'MAILJET_SECRET_KEY',
  ];

  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missingEnvVars.length > 0) {
    console.error('FATAL: Missing required environment variables:', missingEnvVars);
    process.exit(1);
  }
}

const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.2,
  });
}

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
// OPTIMIZATION #38: Add compression middleware for gzip/brotli
const compression = require('compression');

const authRoutes = require('./routes/auth');
const auth2FARoutes = require('./routes/auth-2fa');
const userRoutes = require('./routes/users');
const verificationRoutes = require('./routes/verification');
const subscriptionRoutes = require('./routes/subscriptions');
const projectRoutes = require('./routes/projects');
const professionalRoutes = require('./routes/professionals');
const quoteRoutes = require('./routes/quotes');
const messageRoutes = require('./routes/messages');
const companiesRoutes = require('./routes/companies');
const financesRoutes = require('./routes/finances');
const bookingsRoutes = require('./routes/bookings');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const rolePermissionsRoutes = require('./routes/role-permissions');
const notificationRoutes = require('./routes/notifications');
const supportRoutes = require('./routes/support');
const portfolioProjectsRoutes = require('./routes/portfolio-projects');
const reportsRoutes = require('./routes/reports');
const disputeRoutes = require('./routes/disputes');
const availabilityRoutes = require('./routes/availability');
const packageRoutes = require('./routes/packages');
const searchRoutes = require('./routes/search');
const searchGlobalRoutes = require('./routes/search-global');
const badgeRoutes = require('./routes/badges');
const badgeAdminRoutes = require('./routes/badges-admin');
const referralRoutes = require('./routes/referrals');
const referralAdminRoutes = require('./routes/referrals-admin');
const kpisAdminRoutes = require('./routes/kpis-admin');
const analyticsRoutes = require('./routes/analytics');
const videoCallRoutes = require('./routes/videoCalls');
const healthRoutes = require('./routes/health');
const webhooksAdminRoutes = require('./routes/webhooks-admin');
const queuesAdminRoutes = require('./routes/queues-admin');
const backupsAdminRoutes = require('./routes/admin-backups');
const notificationTemplatesRoutes = require('./routes/notification-templates');
const notificationPreferencesRoutes = require('./routes/notification-preferences');
const docsRoutes = require('./routes/docs');
const webhooksGeniuspayRoutes = require('./routes/webhooks-geniuspay');
const paymentsRetryRoutes = require('./routes/payments-retry');
const searchFacetsRoutes = require('./routes/search-facets');
const analyticsDistributionRoutes = require('./routes/analytics-distribution');
const configVersionsRoutes = require('./routes/config-versions');

// Firebase initialization
const { initializeFirebase, getMessaging } = require('./config/firebase-admin');
const { setMessaging } = require('./config/pushNotifications');

// Redis initialization for caching
const redis = require('./config/redis');
const { cacheGet, cacheInvalidate } = require('./middleware/cacheMiddleware');

// Q69: Response size limit middleware
const { responseSizeLimitMiddleware, setResponseLimitHeaders, validatePaginationMiddleware } = require('./middleware/response-size-limit');

const helmet = require('helmet');

const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
app.use(cookieParser());

// ERROR #16: Restrict private IPs in production
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8081', 'http://localhost:19006'];

// En dev, accepter aussi les IPs locales et Expo Go
// En prod, restreindre strictement aux origines explicites
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:19000',
    'http://localhost:19001',
    /^exp:\/\//,
    /^http:\/\/192\.168\..*/,
    /^http:\/\/10\..*/
  );
} else {
  // Production: never allow private IPs
  const logger = require('./utils/logger');
  logger.info('[CORS] Production mode: private IPs restricted', { publicOrigins: process.env.CORS_ORIGINS || 'localhost only' });
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Helmet : CSP désactivée sur le panel admin (onclick inline + scripts CDN)
// Routes API : CSP restrictive + headers sécurité complets (corrige ZAP alerts)
const ADMIN_PANEL_PATH_EARLY = process.env.ADMIN_PANEL_PATH || '/admin';
app.use((req, res, next) => {
  if (req.path.startsWith(ADMIN_PANEL_PATH_EARLY) || req.path.startsWith('/admin')) {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "https://*.openstreetmap.org", "https://unpkg.com", "https://*.tile.openstreetmap.org"],
          connectSrc: ["'self'", "https://api.ipify.org", "https://unpkg.com"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })(req, res, next);
  }
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'none'"],
        fontSrc: ["'none'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })(req, res, next);
});

// Cache-Control: no-store sur les routes API sensibles (corrige ZAP alert)
// req.originalUrl contient le chemin complet (/api/v1/auth/login), pas req.path (/login)
const SENSITIVE_API_PATHS = ['/api/v1/auth', '/api/v1/payments', '/api/v1/users', '/api/v1/admin', '/api/v1/verification', '/api/v1/subscriptions'];
app.use((req, res, next) => {
  if (SENSITIVE_API_PATHS.some(p => req.originalUrl.startsWith(p))) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

app.use(cors({ origin: allowedOrigins, credentials: true }));

// OPTIMIZATION #38: Enable compression for JSON/text responses
// Reduce response size by 70-80% for text-based content
app.use(compression({
  level: 6, // Balance between speed and compression ratio
  threshold: 1024, // Only compress responses > 1KB
  type: ['application/json', 'text/html', 'text/css', 'text/javascript', 'application/javascript'],
}));
console.log('[Compression] Enabled gzip compression for API responses');

// Q69: Response size limit middleware - check Content-Length < 5MB
app.use(setResponseLimitHeaders);
app.use(responseSizeLimitMiddleware);
console.log('[Q69] Response size limit middleware registered (5MB max)');

// Initialize Firebase
const firebaseApp = initializeFirebase();
if (firebaseApp) {
  try {
    const messaging = getMessaging();
    setMessaging(messaging);
    console.log('[Server] Firebase Cloud Messaging initialized ✅');
  } catch (err) {
    console.error('[Server] Firebase messaging initialization failed:', err.message);
  }
}

const io = new Server(server, {
  cors: { origin: allowedOrigins },
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans quelques minutes' },
});
app.use(globalLimiter);

// ERROR #13: Add rate limiter to /uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de téléchargement, réessayez dans une heure' },
});

// API Versioning middleware
const { versioningHeadersMiddleware, apiRedirectMiddleware, versionValidationMiddleware } = require('./middleware/versioningMiddleware');

// Q59: API Timeout middleware for third-party endpoints
const { paymentTimeoutMiddleware, subscriptionTimeoutMiddleware } = require('./middleware/api-timeout');

// Serve favicon
app.use('/favicon.png', express.static(require('path').join(__dirname, '../public/favicon.png')));
app.use('/uploads', uploadLimiter, express.static(require('path').join(__dirname, '../uploads')));
app.use('/admin', express.static(require('path').join(__dirname, '../public/admin')));

// Q55 + Q56: Middleware de vérification de signature webhook
const { captureRawBody, webhookSignatureVerification } = require('./middleware/webhook-signature-verification');

// Q55: Capturer le body brut AVANT JSON parsing (pour signature verification)
app.use(captureRawBody);

// JSON parsing avec gestion spéciale des webhooks
app.use((req, res, next) => {
  // Skip JSON parsing for webhook endpoints (both old and new paths)
  if (req.originalUrl === '/api/payments/webhooks/geniuspay' ||
      req.originalUrl === '/api/payments/notify' ||
      req.originalUrl === '/api/subscriptions/notify' ||
      req.originalUrl === '/api/v1/payments/webhooks/geniuspay' ||
      req.originalUrl === '/api/v1/payments/notify' ||
      req.originalUrl === '/api/v1/subscriptions/notify') {
    return next();
  }
  express.json({ limit: '1mb' })(req, res, next);
});

// Documentation routes (must be before /api routes)
app.use('/docs', docsRoutes);

// IMPORTANT: API Versioning Support
// Apply versioning middleware to all responses
app.use(versioningHeadersMiddleware);

// Redirect middleware: /api/* → /api/v1/* (for backwards compatibility)
// This must come before individual route handlers but after /api is established
const apiV0Redirect = (req, res, next) => {
  // Only redirect if the request path starts with /api/ but NOT /api/v1/
  if (req.path.match(/^\/api\/(?!v[0-9])/) && req.method !== 'OPTIONS') {
    const targetPath = `/api/v1${req.path.substring(4)}`;
    const fullUrl = targetPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
    return res.redirect(301, fullUrl);
  }
  next();
};

// Injecte le cookie httpOnly adminToken comme Bearer header
// Appliqué sur /api/v1/quotes ET /api/v1/admin pour permettre l'accès depuis le back-office
const injectAdminCookie = (req, res, next) => {
  const cookieToken = req.cookies?.adminToken;
  if (cookieToken && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${cookieToken}`;
  }
  next();
};

// ============================================================
// API v1 Routes (New versioned structure)
// ============================================================
const apiV1Router = express.Router();

apiV1Router.use('/health', healthRoutes);
apiV1Router.use('/auth', authRoutes);
apiV1Router.use('/auth/2fa', auth2FARoutes);
apiV1Router.use('/users', userRoutes);
apiV1Router.use('/verification', verificationRoutes);
// Q59: Apply 30s timeout middleware to subscriptions routes
apiV1Router.use('/subscriptions', subscriptionTimeoutMiddleware, subscriptionRoutes);
apiV1Router.use('/projects', projectRoutes);
apiV1Router.use('/professionals', professionalRoutes);
apiV1Router.use('/quotes', injectAdminCookie, quoteRoutes);
apiV1Router.use('/messages', messageRoutes);
apiV1Router.use('/messaging', messageRoutes);
apiV1Router.use('/companies', companiesRoutes);
apiV1Router.use('/finances', financesRoutes);
apiV1Router.use('/bookings', bookingsRoutes);
apiV1Router.use('/reviews', reviewRoutes);
// Q59: Apply 30s timeout middleware to payment routes
apiV1Router.use('/payments', paymentTimeoutMiddleware, paymentRoutes);
// Q53: Payment retry routes
apiV1Router.use('/payments', paymentTimeoutMiddleware, paymentsRetryRoutes);
apiV1Router.use('/payment-stats', paymentRoutes);
apiV1Router.use('/admin', injectAdminCookie, adminRoutes);
apiV1Router.use('/admin/badges', injectAdminCookie, badgeAdminRoutes);
apiV1Router.use('/admin/referrals', injectAdminCookie, referralAdminRoutes);
apiV1Router.use('/admin/kpis', injectAdminCookie, kpisAdminRoutes);
apiV1Router.use('/admin/webhooks', injectAdminCookie, webhooksAdminRoutes);
apiV1Router.use('/admin/queues', injectAdminCookie, queuesAdminRoutes);
apiV1Router.use('/admin/backups', injectAdminCookie, backupsAdminRoutes);
// Q77 + Q78: Configuration versioning & rollback
apiV1Router.use('/admin/config/versions', injectAdminCookie, configVersionsRoutes);
apiV1Router.use('/role-permissions', injectAdminCookie, rolePermissionsRoutes);
apiV1Router.use('/support', supportRoutes);
apiV1Router.use('/portfolio-projects', portfolioProjectsRoutes);
apiV1Router.use('/notifications', notificationRoutes);
apiV1Router.use('/admin/notification-templates', injectAdminCookie, notificationTemplatesRoutes);
apiV1Router.use('/users/notification-preferences', notificationPreferencesRoutes);
apiV1Router.use('/reports', reportsRoutes);
apiV1Router.use('/moderation', reportsRoutes);
apiV1Router.use('/disputes', disputeRoutes);
apiV1Router.use('/availability', availabilityRoutes);
apiV1Router.use('/packages', packageRoutes);
apiV1Router.use('/search', searchRoutes);
apiV1Router.use('/search', searchFacetsRoutes);
apiV1Router.use('/search/global', searchGlobalRoutes);
apiV1Router.use('/badges', badgeRoutes);
apiV1Router.use('/referrals', referralRoutes);
apiV1Router.use('/analytics', analyticsRoutes);
apiV1Router.use('/analytics', analyticsDistributionRoutes);
apiV1Router.use('/video-calls', videoCallRoutes);
apiV1Router.use('/webhooks/geniuspay', webhooksGeniuspayRoutes);

// Mount versioned API routes
app.use('/api/v1', apiV1Router);

// Apply redirect middleware AFTER v1 routes to catch old /api/* paths
app.use(apiV0Redirect);

// Panel d'administration
const prismaForIPGuard = require('./config/db');
const fs = require('fs');
const adminPanelDir = require('path').join(__dirname, '../admin-panel');

// Cache-busting : hash MD5 de dashboard.js calculé au démarrage
let dashboardHash = 'v1';
try {
  const content = fs.readFileSync(require('path').join(adminPanelDir, 'dashboard.js'));
  dashboardHash = require('crypto').createHash('md5').update(content).digest('hex').slice(0, 8);
} catch {}

// Restriction IP : lit la liste en DB (AppConfig key=admin_allowed_ips)
const adminIPGuard = async (req, res, next) => {
  try {
    const row = await prismaForIPGuard.appConfig.findUnique({ where: { key: 'admin_allowed_ips' } });
    let allowedIPs = [];
    if (row) { try { allowedIPs = JSON.parse(row.value).map(e => e.ip); } catch {} }
    if (allowedIPs.length === 0) return next();
    const clientIP = (req.ip || '').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
    if (allowedIPs.includes(clientIP)) return next();
    console.warn(`[AdminPanel] IP refusée : ${clientIP}`);
    return res.status(403).send('Accès interdit');
  } catch { return res.status(503).send('Accès temporairement indisponible'); }
};

// Auth cookie : login.html, login.js et les assets statiques (.js/.css) sont publics
const adminPanelAuth = (req, res, next) => {
  if (req.path === '/login.html' || req.path === '/login.js') return next();
  if (req.path.match(/\.(js|css|png|jpg|ico|svg|woff2?)(\?.*)?$/)) return next();
  const token = req.cookies?.adminToken;
  if (!token) return res.redirect('/admin/login.html');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.redirect('/admin/login.html');
    next();
  } catch { return res.redirect('/admin/login.html'); }
};

// Servir index.html avec hash injecté et Cache-Control no-store
app.use('/admin', adminIPGuard, adminPanelAuth, (req, res, next) => {
  if (req.path !== '/' && req.path !== '/index.html') return next();
  try {
    let html = fs.readFileSync(require('path').join(adminPanelDir, 'index.html'), 'utf8');
    html = html.replace(/dashboard\.js(\?v=[^"']*)?/g, 'dashboard.js?v=' + dashboardHash);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch { return next(); }
});

app.use('/admin', adminIPGuard, adminPanelAuth, express.static(adminPanelDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

// Health check endpoints (available in both old and new paths for backwards compatibility)
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(301, '/api/v1/health');
});

app.get('/api/v1/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

// Redirection QR code profil pro — manawa://pro/:id si app installée, sinon page web
app.get('/p/:proId', (req, res) => {
  const { proId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(proId)) return res.status(400).send('ID invalide');
  const deepLink = `manawa://pro/${proId}`;
  const storeUrl = 'https://play.google.com/store/apps/details?id=com.manawa.app';
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Profil artisan MANAWA</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #0A0D14; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 16px; padding: 24px; box-sizing: border-box; text-align: center; }
    .logo { font-size: 28px; font-weight: 900; color: #F4720B; letter-spacing: 2px; }
    p { color: rgba(255,255,255,0.65); font-size: 15px; line-height: 1.5; }
    a.btn { display: inline-block; background: #F4720B; color: #fff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 15px; }
    a.store { color: rgba(255,255,255,0.45); font-size: 13px; }
  </style>
</head>
<body>
  <div class="logo">MANAWA</div>
  <p>Ouvrez ce profil dans l'application MANAWA</p>
  <a class="btn" href="${deepLink}">Ouvrir dans l'app</a>
  <a class="store" href="${storeUrl}">Télécharger MANAWA</a>
  <script>window.location.href = "${deepLink}";</script>
</body>
</html>`);
});

// Messagerie temps réel (Socket.IO) — authentification par token JWT
// NEW: Initialize Socket.IO with complete handler system
const { initializeSocket } = require('./socket/manager');
initializeSocket(io);

// Sentry error handler (doit être avant le handler custom)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ERROR #11: Return correct HTTP status codes (400/403/404)
// Middleware global d'erreurs
app.use((err, req, res, next) => {
  const logger = require('./utils/logger');
  logger.error('Unhandled error', { stack: err.stack, message: err.message, status: err.status });

  // Determine the correct status code
  let statusCode = err.status || 500;
  if (err.code === 'RESOURCE_NOT_FOUND') statusCode = 404;
  if (err.code === 'FORBIDDEN') statusCode = 403;
  if (err.code === 'BAD_REQUEST') statusCode = 400;

  res.status(statusCode).json({ error: 'Erreur interne du serveur' });
});

// Expiration automatique des devis — vérifie toutes les heures
const prisma = require('./config/db');

async function expireQuotes() {
  try {
    const { count } = await prisma.quote.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    if (count > 0) console.log(`[CRON] ${count} devis expiré(s)`);
  } catch (err) {
    console.error('[CRON] Erreur expiration devis:', err.message);
  }
}

setInterval(expireQuotes, 60 * 60 * 1000);
expireQuotes();

// Nettoyage des refresh tokens expirés (toutes les 24h)
async function cleanExpiredRefreshTokens() {
  try {
    const { count } = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) console.log(`[CRON] ${count} refresh token(s) expiré(s) supprimé(s)`);
  } catch (err) {
    console.error('[CRON] Erreur nettoyage refresh tokens:', err.message);
  }
}

setInterval(cleanExpiredRefreshTokens, 24 * 60 * 60 * 1000);
cleanExpiredRefreshTokens();

// Expiration automatique des paiements pending depuis plus de 1h
const { logPaymentStatus } = require('./utils/paymentAudit');

async function expirePendingPayments() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const expiredPayments = await prisma.payment.findMany({
      where: { status: 'pending', createdAt: { lt: oneHourAgo } },
      select: { id: true, status: true },
    });
    if (expiredPayments.length === 0) return;

    await prisma.payment.updateMany({
      where: { id: { in: expiredPayments.map(p => p.id) } },
      data: { status: 'failed' },
    });

    for (const p of expiredPayments) {
      await logPaymentStatus({ paymentId: p.id, fromStatus: 'pending', toStatus: 'failed', reason: 'cron_expiry' });
    }

    console.log(`[CRON] ${expiredPayments.length} paiement(s) pending expiré(s)`);
  } catch (err) {
    console.error('[CRON] Erreur expiration paiements:', err.message);
  }
}

setInterval(expirePendingPayments, 60 * 60 * 1000);
expirePendingPayments();

// Réconciliation paiements pending < 1h avec GeniusPay (filet de sécurité)
// Couvre les cas où : webhook manqué + client n'a pas retenté + paiement < 1h
const geniuspay = require('./utils/geniuspay');

async function reconcilePendingPayments() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Seulement les pending récents (< 1h) — les plus anciens sont gérés par expirePendingPayments
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: 'pending',
        geniuspayRef: { not: null },
        createdAt: { gte: oneHourAgo },
      },
      select: { id: true, status: true, geniuspayRef: true, amount: true },
    });

    if (pendingPayments.length === 0) return;
    console.log(`[CRON] Réconciliation : ${pendingPayments.length} paiement(s) pending à vérifier`);

    let synced = 0;
    let failed = 0;

    for (const payment of pendingPayments) {
      try {
        const gpResponse = await geniuspay.getPayment(payment.geniuspayRef);
        const gpData = gpResponse?.data || gpResponse;
        const realStatus = gpData?.status;

        if (realStatus === 'completed' || realStatus === 'success') {
          const receivedAmount = gpData?.amount || gpData?.paid_amount;
          if (receivedAmount !== undefined && Math.abs(receivedAmount - payment.amount) > 1) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: 'failed', metadata: JSON.stringify({ reason: 'amount_mismatch', expected: payment.amount, received: receivedAmount }) },
            });
            await logPaymentStatus({ paymentId: payment.id, fromStatus: 'pending', toStatus: 'failed', reason: 'amount_mismatch', metadata: { expected: payment.amount, received: receivedAmount } });
            failed++;
          } else {
            await prisma.payment.update({ where: { id: payment.id }, data: { status: 'succeeded', completedAt: new Date() } });
            await logPaymentStatus({ paymentId: payment.id, fromStatus: 'pending', toStatus: 'succeeded', reason: 'reconciliation' });
            synced++;
          }
        } else if (realStatus === 'failed' || realStatus === 'cancelled' || realStatus === 'expired') {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
          await logPaymentStatus({ paymentId: payment.id, fromStatus: 'pending', toStatus: 'failed', reason: 'reconciliation', metadata: { geniuspayStatus: realStatus } });
          failed++;
        }
        // Si GeniusPay retourne encore 'pending' → on ne touche rien, on re-vérifie au prochain cron
      } catch (err) {
        // GeniusPay injoignable pour ce paiement — on ignore, on réessaiera au prochain tour
        console.warn(`[CRON] Réconciliation — impossible de vérifier ${payment.geniuspayRef}: ${err.message}`);
      }
    }

    if (synced > 0 || failed > 0) {
      console.log(`[CRON] Réconciliation terminée — ${synced} confirmé(s), ${failed} échoué(s)`);
    }
  } catch (err) {
    console.error('[CRON] Erreur réconciliation paiements:', err.message);
  }
}

// Décalage de 30min par rapport aux autres crons pour éviter les pics simultanés
setTimeout(() => {
  reconcilePendingPayments();
  setInterval(reconcilePendingPayments, 60 * 60 * 1000);
}, 30 * 60 * 1000);

// ERROR #20: Add admin log retention policy - cleanup logs older than 90 days
const ADMIN_LOG_RETENTION_DAYS = parseInt(process.env.ADMIN_LOG_RETENTION_DAYS || '90', 10);
async function cleanupOldAdminLogs() {
  try {
    const logger = require('./utils/logger');
    const cutoffDate = new Date(Date.now() - ADMIN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await prisma.adminLog.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });
    if (count > 0) logger.info('[CRON] Admin logs cleanup', { deletedCount: count, retentionDays: ADMIN_LOG_RETENTION_DAYS });
  } catch (err) {
    const logger = require('./utils/logger');
    logger.error('[CRON] Admin logs cleanup error', { error: err.message });
  }
}
setInterval(cleanupOldAdminLogs, 24 * 60 * 60 * 1000);
cleanupOldAdminLogs();

// Q54: Webhook retry scheduler - runs every 30 minutes
const { webhookRetryScheduler } = require('./jobs/webhook-retry-scheduler');
async function scheduleWebhookRetries() {
  try {
    const logger = require('./utils/logger');
    const result = await webhookRetryScheduler();
    logger.debug('[CRON] Webhook retry scheduler completed', result);
  } catch (err) {
    const logger = require('./utils/logger');
    logger.error('[CRON] Webhook retry scheduler error', { error: err.message });
  }
}
// Run immediately on startup (after a delay to ensure DB connection is ready)
setTimeout(scheduleWebhookRetries, 10 * 1000);
// Then run every 30 minutes (30 * 60 * 1000 ms)
setInterval(scheduleWebhookRetries, 30 * 60 * 1000);

// Q52: Schedule daily payment reconciliation (runs at 00:00 UTC)
// Checks ALL pending payments and syncs with GeniusPay
const { schedulePaymentReconciliation } = require('./jobs/payment-reconciliation-daily');
schedulePaymentReconciliation();

// Backup quotidien de la base de données via l'API Neon branching
// ⚠️ DÉCALÉ DE 5MIN AU DÉMARRAGE POUR NE PAS BLOQUER LE SERVEUR
const { createDailyBackupBranch } = require('./utils/dbBackup');
setInterval(createDailyBackupBranch, 24 * 60 * 60 * 1000);
// Appel ASYNCHRONE et décalé (pas au boot, sinon timeout Render)
setTimeout(() => {
  createDailyBackupBranch().catch(err => console.error('[Backup] Startup error:', err.message));
}, 5 * 60 * 1000);

const { seedConfig, ensureSuperAdmin } = require('./utils/appConfig');

const PORT = process.env.PORT || 4000;

async function startServer() {
  const { checkDatabaseHealth } = require('./utils/health-check');
  const logger = require('./utils/logger');

  try {
    // ERROR #25: Validate environment variables at startup
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.error('❌ ERREUR: Variables d\'environnement manquantes:', missingVars.join(', '));
      process.exit(1);
    }

    console.log('⏳ Vérification de la connexion à la base de données...');
    const dbHealth = await checkDatabaseHealth();

    if (dbHealth.status !== 'healthy') {
      console.error('❌ ERREUR: La base de données est injoignable!');
      console.error('Erreur:', dbHealth.error);
      console.error('\nActions à prendre:');
      console.error('  1. Vérifier le statut de Supabase: https://supabase.com/dashboard');
      console.error('  2. Vérifier DATABASE_URL dans .env');
      console.error('  3. Vérifier la connexion réseau/firewall');
      process.exit(1);
    }

    console.log('✓ Connexion à la base de données établie');

    // Initialize Redis cache
    console.log('⏳ Initialisation du cache Redis...');
    await redis.initializeRedis();
    const cacheHealth = await redis.healthCheck();
    console.log(`✓ Cache ${cacheHealth.mode}: ${cacheHealth.message}`);

    // Initialize job queue workers
    console.log('⏳ Initialisation des workers de file d\'attente...');
    const { initializeWorkers, shutdownWorkers } = require('./jobs/workers');
    try {
      await initializeWorkers();
      console.log('✓ Workers de file d\'attente initialisés');
    } catch (err) {
      console.error('⚠️  Erreur initialisation workers (non-bloquant):', err.message);
    }

    // Q56: Initialize webhook queue
    console.log('⏳ Initialisation de la queue webhook...');
    try {
      const { initializeWebhookQueue } = require('./utils/webhook-queue-manager');
      await initializeWebhookQueue();
      console.log('✓ Queue webhook initialisée');
    } catch (err) {
      console.error('⚠️  Erreur initialisation webhook queue (non-bloquant):', err.message);
    }

    // Q66: Initialize MeiliSearch
    console.log('⏳ Initialisation de MeiliSearch...');
    try {
      const { ensureIndices, healthCheck } = require('./config/meilisearch');
      const meilisearchHealth = await healthCheck();
      if (meilisearchHealth.status === 'ok') {
        await ensureIndices();
        console.log('✓ MeiliSearch initialisé et indices créés');
      } else {
        console.error('⚠️  MeiliSearch indisponible (non-bloquant):', meilisearchHealth.error);
      }
    } catch (err) {
      console.error('⚠️  Erreur initialisation MeiliSearch (non-bloquant):', err.message);
    }

    server.listen(PORT, () => {
      console.log(`✓ Serveur MANAWA démarré sur le port ${PORT}`);
      logger.info('Server started', { port: PORT });
      seedConfig().catch(err => console.error('[Config] Erreur seed:', err.message));
      ensureSuperAdmin().catch(err => console.error('[Boot] Erreur ensureSuperAdmin:', err.message));

      // Q66: Schedule daily MeiliSearch synchronization (1h after startup, then daily)
      setTimeout(() => {
        logger.info('[MeiliSearch] Scheduling daily sync...');
        const { syncAllIndices } = require('./jobs/meilisearch-sync');

        syncAllIndices().catch(err => {
          logger.error('[MeiliSearch] Initial sync error', { error: err.message });
        });

        // Then schedule daily syncs at 02:00 UTC
        setInterval(() => {
          syncAllIndices().catch(err => {
            logger.error('[MeiliSearch] Daily sync error', { error: err.message });
          });
        }, 24 * 60 * 60 * 1000);
      }, 60 * 60 * 1000); // 1 hour after startup
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('⏳ Arrêt du serveur MANAWA...');
      server.close(() => {
        console.log('✓ Serveur arrêté');
      });
      try {
        const { shutdownWorkers } = require('./jobs/workers');
        await shutdownWorkers();
      } catch (err) {
        console.error('Erreur lors de l\'arrêt des workers:', err.message);
      }
      await redis.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Erreur lors du démarrage du serveur:', error.message);
    process.exit(1);
  }
}

// Force Render redeploy - COMPLIANCE Officer endpoints v1
startServer();
// Force rebuild v2
