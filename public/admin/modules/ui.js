// UI Module
// Common UI helpers and DOM utilities

import { state } from './state.js';

// Toast notifications
export function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${isError ? '#ef4444' : '#10b981'};
    color: white;
    padding: 16px;
    border-radius: 8px;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Modal management
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
    state.activeModal = modalId;
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
    if (state.activeModal === modalId) {
      state.activeModal = null;
    }
  }
}

// HTML escaping
export function escHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Date formatting
export function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('fr-FR');
}

// Debounce helper
export function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
}

// Page navigation
export function navigateTo(pageId) {
  document.querySelectorAll('[class*="page-"]').forEach(page => {
    page.style.display = 'none';
  });
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.style.display = 'block';
    state.currentPage = pageId;
  }
}
