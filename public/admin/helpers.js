/**
 * MANAWA Admin Panel - Helpers Library
 * Reusable utilities for all admin modules
 * Version 1.0
 */

// ============================================================================
// 1. API Call Helper - Standardized fetch wrapper
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
// 2. Table Rendering Helper - Generic table builder
// ============================================================================

/**
 * Render HTML table from data array
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<Object>} columns - Column definitions
 *   [{ key: 'id', label: 'ID', sortable: true, renderer: fn },...]
 * @param {Object} handlers - Event handlers { onEdit, onDelete, onAction }
 * @returns {HTMLTableElement} - Built table element
 */
function renderTable(data = [], columns = [], handlers = {}) {
  const table = document.createElement('table');
  table.className = 'admin-table';

  // Create thead
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col.label || col.key;

    if (col.sortable) {
      th.className = 'sortable';
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const event = new CustomEvent('sort', { detail: { key: col.key } });
        table.dispatchEvent(event);
      });
    }

    headerRow.appendChild(th);
  });

  // Add actions column header if handlers exist
  if (Object.keys(handlers).length > 0) {
    const th = document.createElement('th');
    th.textContent = 'Actions';
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create tbody
  const tbody = document.createElement('tbody');

  if (data.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length + (Object.keys(handlers).length > 0 ? 1 : 0);
    td.textContent = 'No data available';
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = '#666';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    data.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.rowIndex = rowIndex;

      // Render columns
      columns.forEach((col) => {
        const td = document.createElement('td');
        const value = row[col.key];

        if (col.renderer && typeof col.renderer === 'function') {
          td.innerHTML = col.renderer(value, row);
        } else {
          td.textContent = value !== undefined && value !== null ? String(value) : '-';
        }

        tr.appendChild(td);
      });

      // Render actions
      if (Object.keys(handlers).length > 0) {
        const td = document.createElement('td');
        td.className = 'action-cell';

        if (handlers.onEdit) {
          const editBtn = document.createElement('button');
          editBtn.className = 'btn btn-sm btn-primary';
          editBtn.textContent = 'Edit';
          editBtn.addEventListener('click', () => handlers.onEdit(row, rowIndex));
          td.appendChild(editBtn);
        }

        if (handlers.onDelete) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn btn-sm btn-danger';
          deleteBtn.textContent = 'Delete';
          deleteBtn.addEventListener('click', () => {
            if (confirm('Are you sure?')) {
              handlers.onDelete(row, rowIndex);
            }
          });
          td.appendChild(deleteBtn);
        }

        if (handlers.onAction) {
          Object.entries(handlers.onAction).forEach(([actionName, handler]) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-secondary';
            btn.textContent = actionName;
            btn.addEventListener('click', () => handler(row, rowIndex));
            td.appendChild(btn);
          });
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  return table;
}

// ============================================================================
// 3. Modal Management - Open/Close helpers
// ============================================================================

/**
 * Open modal by ID with optional data
 * @param {string} modalId - Modal element ID
 * @param {Object} data - Optional data to pass to modal
 */
function openModal(modalId, data = null) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.error(`Modal not found: ${modalId}`);
    return;
  }

  modal.classList.add('modal-open');
  modal.style.display = 'flex';

  // Store data on modal for retrieval
  if (data) {
    modal.dataset.modalData = JSON.stringify(data);
  }

  // Dispatch custom event
  const event = new CustomEvent('modalOpen', { detail: { id: modalId, data } });
  modal.dispatchEvent(event);
}

/**
 * Close modal by ID with optional result
 * @param {string} modalId - Modal element ID
 * @param {*} result - Optional result data
 */
function closeModal(modalId, result = null) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.error(`Modal not found: ${modalId}`);
    return;
  }

  modal.classList.remove('modal-open');
  modal.style.display = 'none';

  // Dispatch custom event
  const event = new CustomEvent('modalClose', { detail: { id: modalId, result } });
  modal.dispatchEvent(event);

  // Clear stored data
  delete modal.dataset.modalData;
}

/**
 * Setup modal backdrop close behavior
 * @param {string} modalId - Modal element ID
 */
function setupModalBackdropClose(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modalId);
    }
  });
}

// ============================================================================
// 4. Toast Notifications - Success/Error messages
// ============================================================================

let toastContainer = null;

/**
 * Initialize toast container (call once on page load)
 */
function initToastContainer() {
  if (toastContainer) return;

  toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;
  document.body.appendChild(toastContainer);
}

/**
 * Show toast notification
 * @param {string} message - Notification message
 * @param {boolean} isError - Is this an error notification
 * @param {number} duration - Duration in ms (0 = no auto-close)
 */
function showToast(message, isError = false, duration = 3000) {
  if (!toastContainer) {
    initToastContainer();
  }

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  toast.style.cssText = `
    padding: 12px 16px;
    border-radius: 4px;
    color: white;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease-in-out;
    background-color: ${isError ? '#dc3545' : '#28a745'};
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 250px;
  `;

  const icon = document.createElement('span');
  icon.textContent = isError ? '✕' : '✓';
  icon.style.fontWeight = 'bold';
  icon.style.fontSize = '16px';

  const text = document.createElement('span');
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in-out';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return toast;
}

// ============================================================================
// 5. Validation Helpers
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
// 6. XSS Protection - HTML escaping
// ============================================================================

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Raw text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Create safe HTML element from text
 * @param {string} tagName - HTML tag name
 * @param {string} textContent - Text content (auto-escaped)
 * @param {Object} attributes - Element attributes
 * @returns {HTMLElement} - Safe HTML element
 */
function createSafeElement(tagName, textContent = '', attributes = {}) {
  const element = document.createElement(tagName);

  // Set text content (automatically escaped)
  if (textContent) {
    element.textContent = textContent;
  }

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'id') {
      element.id = value;
    } else if (key.startsWith('data-')) {
      element.dataset[key.substring(5)] = value;
    } else if (!key.startsWith('on')) {
      // Skip event handlers for safety
      element.setAttribute(key, escapeHtml(String(value)));
    }
  });

  return element;
}

// ============================================================================
// 7. CSRF Token Management
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
// 8. Debounce - Rate-limiting for search/filter
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
// 9. Date Formatting
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
// 10. Currency Formatting
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
// Initialization & Exports
// ============================================================================

// Initialize toast container on page load
document.addEventListener('DOMContentLoaded', () => {
  initToastContainer();

  // Add CSS animations
  if (!document.getElementById('helpers-animations')) {
    const style = document.createElement('style');
    style.id = 'helpers-animations';
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }

      .modal-open {
        animation: fadeIn 0.3s ease-in-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .admin-table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
      }

      .admin-table thead {
        background-color: #f8f9fa;
      }

      .admin-table th {
        padding: 12px;
        text-align: left;
        border-bottom: 2px solid #dee2e6;
        font-weight: 600;
      }

      .admin-table th.sortable {
        cursor: pointer;
        user-select: none;
      }

      .admin-table th.sortable:hover {
        background-color: #e9ecef;
      }

      .admin-table td {
        padding: 12px;
        border-bottom: 1px solid #dee2e6;
      }

      .admin-table tr:hover {
        background-color: #f8f9fa;
      }

      .action-cell {
        display: flex;
        gap: 6px;
      }

      .btn {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn:hover {
        opacity: 0.9;
      }

      .btn-primary {
        background-color: #007bff;
        color: white;
      }

      .btn-danger {
        background-color: #dc3545;
        color: white;
      }

      .btn-secondary {
        background-color: #6c757d;
        color: white;
      }

      .btn-sm {
        padding: 4px 8px;
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }
});
