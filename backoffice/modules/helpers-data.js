/**
 * Data Helpers Module
 * CSRF management, date/currency formatting, API calls
 * Part of MANAWA Admin Helpers Library
 */

// ============================================================================
// API Call Helper - Standardized fetch wrapper
// ============================================================================

/**
 * Standardized API call wrapper with CSRF protection
 * @param {string} endpoint - API endpoint path (e.g., '/api/admin/users')
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Object>} - API response { success, data, error, statusCode }
 */
async function apiCall(endpoint, options = {}) {
  try {
    const {
      method = 'GET',
      body = null,
      headers = {},
      timeout = 30000,
      retries = 1,
    } = options;

    // Add CSRF token to headers for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const csrfToken = getCsrfToken();
      headers['X-CSRF-Token'] = csrfToken;
    }

    // Set default content-type for JSON
    if (body && typeof body === 'object' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Prepare fetch config
    const config = {
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    };

    if (body) {
      config.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(endpoint, {
        ...config,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        // Retry logic for 5xx errors
        if (response.status >= 500 && retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return apiCall(endpoint, { ...options, retries: retries - 1 });
        }

        return {
          success: false,
          data: null,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status,
        };
      }

      return {
        success: true,
        data,
        error: null,
        statusCode: response.status,
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          data: null,
          error: `Request timeout after ${timeout}ms`,
          statusCode: 0,
        };
      }
      throw error;
    }
  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);
    return {
      success: false,
      data: null,
      error: error.message || 'Unknown error',
      statusCode: 0,
    };
  }
}

// ============================================================================
// CSRF Token Management
// ============================================================================

/**
 * Get CSRF token from DOM
 * @returns {string} - CSRF token
 */
function getCsrfToken() {
  // Try meta tag first
  let token = document.querySelector('meta[name="csrf-token"]')?.content;

  if (token) return token;

  // Try cookie fallback
  const cookieName = 'XSRF-TOKEN';
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${cookieName}=`);

  if (parts.length === 2) {
    token = parts.pop().split(';').shift();
    return token;
  }

  // Last resort - hidden input
  token = document.querySelector('input[name="_csrf"]')?.value;

  return token || '';
}

/**
 * Verify CSRF token validity (client-side check)
 * @returns {boolean} - Token exists and is non-empty
 */
function verifyCsrfToken() {
  const token = getCsrfToken();
  return token && token.length > 0;
}

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format date to localized string
 * @param {Date|string|number} date - Date to format
 * @param {string} format - Format style: 'short', 'long', 'full', 'time'
 * @returns {string} - Formatted date
 */
function formatDate(date, format = 'short') {
  try {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      return 'Invalid date';
    }

    const options = {
      short: { year: 'numeric', month: '2-digit', day: '2-digit' },
      long: { year: 'numeric', month: 'long', day: 'numeric' },
      full: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
      datetime: {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      },
    };

    return dateObj.toLocaleDateString('en-US', options[format] || options.short);
  } catch (error) {
    console.error('Date formatting error:', error);
    return 'Invalid date';
  }
}

/**
 * Format date relative to now (e.g., '2 hours ago')
 * @param {Date|string|number} date - Date to format
 * @returns {string} - Relative time string
 */
function formatRelativeTime(date) {
  try {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now - dateObj;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return `${diffSecs} seconds ago`;
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return formatDate(dateObj, 'short');
  } catch (error) {
    console.error('Relative time formatting error:', error);
    return 'Invalid date';
  }
}

// ============================================================================
// Currency Formatting
// ============================================================================

/**
 * Format number as currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default 'USD')
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted currency string
 */
function formatCurrency(amount, currency = 'USD', decimals = 2) {
  try {
    const num = parseFloat(amount);

    if (isNaN(num)) {
      return 'Invalid amount';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  } catch (error) {
    console.error('Currency formatting error:', error);
    return `${amount}`;
  }
}

/**
 * Format large numbers with K/M/B suffix
 * @param {number} num - Number to format
 * @param {number} decimals - Decimal places
 * @returns {string} - Formatted number
 */
function formatNumber(num, decimals = 1) {
  const n = parseFloat(num);

  if (isNaN(n)) return '0';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';

  return n.toFixed(decimals);
}

// ============================================================================
// Module Exports
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    apiCall,
    getCsrfToken,
    verifyCsrfToken,
    formatDate,
    formatRelativeTime,
    formatCurrency,
    formatNumber,
  };
}
