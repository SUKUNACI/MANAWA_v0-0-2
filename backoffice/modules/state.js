// Global State Management
// Centralized state for the admin dashboard

export const state = {
  // Auth
  currentUser: null,
  authToken: null,
  csrfToken: null,

  // Moderation
  currentReportId: null,
  _moderationAuthorId: null,
  modCurrentPage: 1,

  // Reservations
  _currentReservationId: null,
  _reservationsDebounceTimer: null,
  _reservationsProsCache: new Map(),

  // Disputes
  currentDisputeId: null,

  // UI
  currentPage: 'dashboard',
  activeModal: null,
};

// Getters
export function getState(key) {
  // For admin user info
  if (!state[key] && key === 'currentUser') {
    const user = sessionStorage.getItem('adminUser');
    if (user) {
      try {
        state.currentUser = JSON.parse(user);
        return state.currentUser;
      } catch {
        return null;
      }
    }
  }
  return state[key];
}

// Setters
export function setState(key, value) {
  state[key] = value;
}

// Batch setters
export function setStateMultiple(updates) {
  Object.assign(state, updates);
}

// Reset state (logout)
export function resetState() {
  state.currentUser = null;
  state.authToken = null;
  state.csrfToken = null;
  state.currentReportId = null;
  state._moderationAuthorId = null;
  state._currentReservationId = null;
  state.currentDisputeId = null;
  state.currentPage = 'dashboard';
  // ✅ CSRF token is now httpOnly cookie (cleared server-side)
  // Sensitive data is in-memory only
}
