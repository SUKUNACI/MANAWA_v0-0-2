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
// Form Styles - Touch-Friendly & Responsive
// ============================================================================

/**
 * Initialize touch-friendly form styles (call on DOMContentLoaded)
 */
function initializeFormStyles() {
  if (document.getElementById('helpers-form-styles')) return;

  const style = document.createElement('style');
  style.id = 'helpers-form-styles';
  style.textContent = `
    /* ═══════════════════════════════════════════════════════════════ */
    /* FORM ELEMENTS - TOUCH-FRIENDLY                                 */
    /* ═══════════════════════════════════════════════════════════════ */
    input,
    select,
    textarea {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid #dee2e6;
      border-radius: 4px;
      font-size: 16px;
      font-family: inherit;
      background-color: white;
      color: #212529;
      outline: none;
      transition: all 0.2s ease;
      -webkit-appearance: none;
      appearance: none;
      min-height: 44px;
    }

    input:focus,
    select:focus,
    textarea:focus {
      border-color: #007bff;
      box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
    }

    textarea {
      min-height: 100px;
      resize: vertical;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    input[type="checkbox"],
    input[type="radio"] {
      width: auto;
      min-height: auto;
      margin-right: 8px;
      cursor: pointer;
    }

    select {
      cursor: pointer;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 20px;
      padding-right: 36px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #495057;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .form-row .form-group {
      margin-bottom: 0;
    }

    .form-error {
      color: #dc3545;
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }

    .form-group.is-invalid input,
    .form-group.is-invalid select,
    .form-group.is-invalid textarea {
      border-color: #dc3545;
    }

    .form-group.is-invalid .form-error {
      display: block;
    }

    .form-hint {
      color: #6c757d;
      font-size: 12px;
      margin-top: 4px;
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /* FORM LAYOUT - RESPONSIVE                                        */
    /* ═══════════════════════════════════════════════════════════════ */
    .form-container {
      max-width: 600px;
      margin: 0 auto;
    }

    @media (max-width: 768px) {
      .form-row {
        grid-template-columns: 1fr;
        gap: 12px;
      }

      input,
      select,
      textarea {
        font-size: 16px;
      }

      label {
        font-size: 12px;
      }
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /* FORM GROUPS - RESPONSIVE                                        */
    /* ═══════════════════════════════════════════════════════════════ */
    @media (max-width: 480px) {
      .form-group {
        margin-bottom: 14px;
      }

      input,
      select,
      textarea {
        padding: 10px 12px;
      }
    }
  `;
  document.head.appendChild(style);
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
    initializeFormStyles,
  };
}
