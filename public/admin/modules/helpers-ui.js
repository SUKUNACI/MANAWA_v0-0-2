/**
 * UI Helpers Module
 * Modal management, toast notifications, and DOM utilities
 * Part of MANAWA Admin Helpers Library
 */

// ============================================================================
// Modal Management
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
// Toast Notifications
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
// Safe HTML Element Creation
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
// CSS Animations Initialization
// ============================================================================

/**
 * Initialize UI animations (call on DOMContentLoaded)
 */
function initializeUiAnimations() {
  if (document.getElementById('helpers-animations')) return;

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

// ============================================================================
// Module Exports
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openModal,
    closeModal,
    setupModalBackdropClose,
    initToastContainer,
    showToast,
    escapeHtml,
    createSafeElement,
    initializeUiAnimations,
  };
}
