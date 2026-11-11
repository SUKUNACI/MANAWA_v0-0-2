// API Module
// Centralized API calls with error handling

import { getState } from './state.js';

const API_BASE = window.location.origin + '/api';

export async function apiCall(endpoint, options = {}) {
  const authToken = getState('authToken');
  // ✅ CSRF token from httpOnly cookie only (not localStorage)
  const csrfToken = getState('csrfToken');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Add CSRF token for state-changing requests (from httpOnly cookie)
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  try {
    const response = await fetch(API_BASE + endpoint, {
      method,
      headers,
      credentials: 'include',
      body: options.body,
      ...options,
    });

    // Handle session expiration (401 response)
    if (response.status === 401) {
      console.warn('Session expired (401), cleaning up and redirecting to login');
      // Clear sessionStorage auth token
      sessionStorage.removeItem('authToken');
      sessionStorage.removeItem('adminUser');
      // Redirect to login after a brief delay to allow UI to update
      setTimeout(() => {
        window.location.href = '/admin/login.html';
      }, 500);
      throw new Error('Session expired — connexion requise');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return await response.json();
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}

// Convenience methods
export const API = {
  get: (endpoint) => apiCall(endpoint, { method: 'GET' }),
  post: (endpoint, body) => apiCall(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: (endpoint, body) => apiCall(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint) => apiCall(endpoint, { method: 'DELETE' }),
};
