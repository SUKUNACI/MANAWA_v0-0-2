/**
 * Form Helpers Module
 * Validation, debounce, throttle utilities for form inputs
 * Part of MANAWA Admin Helpers Library
 */

// ============================================================================
// Form Validation Helpers
// ============================================================================

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - Is valid email
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number (basic international format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - Is valid phone
 */
function validatePhoneNumber(phone) {
  const phoneRegex = /^[\d\s\-\+\(\)]{7,}$/;
  return phoneRegex.test(phone);
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - Is valid URL
 */
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate number in range
 * @param {number} value - Number to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} - Is valid number in range
 */
function validateNumberRange(value, min, max) {
  const num = parseFloat(value);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Validate required field
 * @param {*} value - Value to validate
 * @returns {boolean} - Is not empty
 */
function validateRequired(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

// ============================================================================
// Rate Limiting: Debounce & Throttle
// ============================================================================

/**
 * Debounce function - delays execution until calls stop
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(fn, delay = 300) {
  let timeoutId = null;

  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function - limits execution frequency
 * @param {Function} fn - Function to throttle
 * @param {number} interval - Minimum interval between calls in ms
 * @returns {Function} - Throttled function
 */
function throttle(fn, interval = 300) {
  let lastCallTime = 0;

  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCallTime >= interval) {
      lastCallTime = now;
      return fn.apply(this, args);
    }
  };
}

// ============================================================================
// Module Exports
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateEmail,
    validatePhoneNumber,
    validateUrl,
    validateNumberRange,
    validateRequired,
    debounce,
    throttle,
  };
}
