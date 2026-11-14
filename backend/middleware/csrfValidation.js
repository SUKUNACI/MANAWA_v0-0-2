/**
 * CSRF Token Validation Middleware
 * Validates CSRF token on state-changing requests (POST, PUT, DELETE, PATCH)
 */

module.exports = function csrfValidation(req, res, next) {
  // Skip validation for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next()
  }

  const tokenFromHeader = req.headers['x-csrf-token'] || req.headers['x-xsrf-token']
  const tokenFromCookie = req.cookies?.csrfToken

  if (!tokenFromHeader || !tokenFromCookie) {
    return res.status(403).json({ error: 'CSRF token missing' })
  }

  if (tokenFromHeader !== tokenFromCookie) {
    return res.status(403).json({ error: 'CSRF token mismatch' })
  }

  next()
}
