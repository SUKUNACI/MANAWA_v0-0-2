// ════════════════════════════════════════════════════════════════
// MANAWA ADMIN DASHBOARD — REFACTORED (Modular)
// ════════════════════════════════════════════════════════════════

// Import all modules
import { state, getState, setState, setStateMultiple, resetState } from './modules/state.js';
import { apiCall, API } from './modules/api.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce, navigateTo } from './modules/ui.js';

// Feature modules
import { Moderation } from './modules/moderation.js';
import { Reservations } from './modules/reservations.js';
import { Disputes } from './modules/disputes.js';
import { Payments } from './modules/payments.js';
import { Professionals } from './modules/professionals.js';
import { Projects } from './modules/projects.js';
import { Subscriptions } from './modules/subscriptions.js';
import { Promos } from './modules/promos.js';
import { Bookings } from './modules/bookings.js';
import { Notifications } from './modules/notifications.js';
import { Analytics } from './modules/analytics.js';
import { Packages } from './modules/packages.js';
import { Support } from './modules/support.js';
import { Badges } from './modules/badges.js';
import { Audit } from './modules/audit.js';
import { Companies } from './modules/companies.js';
import { Finances } from './modules/finances.js';
import { Videos } from './modules/videos.js';
import { Search } from './modules/search.js';
import { Referrals } from './modules/referrals.js';
import { KPIs } from './modules/kpis.js';
import { Portfolio } from './modules/portfolio.js';
import { Settings } from './modules/settings.js';
import { Communication } from './modules/communication.js';
import { PaymentsAdvanced } from './modules/payments-advanced.js';
import { Refunds } from './modules/refunds.js';
import { SupportTickets } from './modules/support-tickets.js';
import { AuditAdvanced } from './modules/audit-advanced.js';
import { DisputesExport } from './modules/disputes-export.js';
import { Insurance } from './modules/insurance.js';
import { SubscriptionsDetail } from './modules/subscriptions-detail.js';
import { ReviewsRatings } from './modules/reviews-ratings.js';
import { DashboardKPIsAdvanced } from './modules/dashboard-kpis-advanced.js';
import { UserManagement } from './modules/user-management.js';
import { FraudDetection } from './modules/fraud-detection.js';
import { APIRateLimits } from './modules/api-rate-limits.js';
import { WebhookManager } from './modules/webhook-manager.js';
import { EmailTemplates } from './modules/email-templates.js';
import { APIKeys } from './modules/api-keys.js';
import { SMSConfig } from './modules/sms-config.js';
import { TwoFactorAuth } from './modules/two-factor-auth.js';
import { DataRetention } from './modules/data-retention.js';
import { BulkCampaigns } from './modules/bulk-campaigns.js';
import { ExportLogs } from './modules/export-logs.js';
import { DashboardCustomization } from './modules/dashboard-customization.js';
import { NotificationPreferences } from './modules/notification-preferences.js';
import { PIIMasking } from './modules/pii-masking.js';
import { RolePermissions } from './modules/role-permissions.js';

// ════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════

export async function initDashboard() {
  console.log('🚀 MANAWA Admin Dashboard initialized');

  // Expose modules to global scope for onclick handlers
  window.Moderation = Moderation;
  window.Reservations = Reservations;
  window.Disputes = Disputes;
  window.Payments = Payments;
  window.Professionals = Professionals;
  window.Projects = Projects;
  window.Subscriptions = Subscriptions;
  window.Promos = Promos;
  window.Bookings = Bookings;
  window.Notifications = Notifications;
  window.Analytics = Analytics;
  window.Packages = Packages;
  window.Support = Support;
  window.Badges = Badges;
  window.Audit = Audit;
  window.Companies = Companies;
  window.Finances = Finances;
  window.Videos = Videos;
  window.Search = Search;
  window.Referrals = Referrals;
  window.KPIs = KPIs;
  window.Companies = Companies;
  window.Portfolio = Portfolio;
  window.Analytics = Analytics;
  window.Settings = Settings;
  window.Communication = Communication;
  window.PaymentsAdvanced = PaymentsAdvanced;
  window.Refunds = Refunds;
  window.SupportTickets = SupportTickets;
  window.AuditAdvanced = AuditAdvanced;
  window.DisputesExport = DisputesExport;
  window.Insurance = Insurance;
  window.SubscriptionsDetail = SubscriptionsDetail;
  window.ReviewsRatings = ReviewsRatings;
  window.DashboardKPIsAdvanced = DashboardKPIsAdvanced;
  window.UserManagement = UserManagement;
  window.FraudDetection = FraudDetection;
  window.APIRateLimits = APIRateLimits;
  window.WebhookManager = WebhookManager;
  window.EmailTemplates = EmailTemplates;
  window.APIKeys = APIKeys;
  window.SMSConfig = SMSConfig;
  window.TwoFactorAuth = TwoFactorAuth;
  window.DataRetention = DataRetention;
  window.BulkCampaigns = BulkCampaigns;
  window.ExportLogs = ExportLogs;
  window.DashboardCustomization = DashboardCustomization;
  window.NotificationPreferences = NotificationPreferences;
  window.PIIMasking = PIIMasking;
  window.RolePermissions = RolePermissions;

  // Expose utilities to global scope
  window.showToast = showToast;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.escHtml = escHtml;
  window.formatDate = formatDate;
  window.navigateTo = navigateTo;
  window.apiCall = apiCall;
  window.refreshCurrentPage = refreshCurrentPage;
  window.exportCurrentPage = exportCurrentPage;
  window.showPage = showPage;
  window.logout = logout;

  // Initialize auth
  await checkAuth();

  // Load dashboard data
  if (window.KPIs && typeof window.KPIs.load === 'function') {
    await window.KPIs.load(1);
  }
}

// ════════════════════════════════════════════════════════════════
// AUTH MANAGEMENT
// ════════════════════════════════════════════════════════════════

// Track token renewal to prevent race conditions
let renewalInProgress = false;
let renewalRetries = 0;
const MAX_RENEWAL_RETRIES = 3;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RENEWAL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (5 min before TTL)

export async function checkAuth() {
  try {
    const res = await fetch(window.location.origin + '/api/auth/admin-session', {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        console.warn('Session expired, redirecting to login');
        window.location.href = '/admin/login.html';
        return;
      }
      throw new Error(`Session check returned ${res.status}`);
    }

    const data = await res.json();
    if (!data.user || !data.token) {
      throw new Error('Invalid session response format');
    }

    setState('currentUser', data.user);
    setState('authToken', data.token);

    // Restore CSRF token from localStorage if available
    const csrfToken = localStorage.getItem('csrfToken');
    if (csrfToken) {
      setState('csrfToken', csrfToken);
    }

    console.log('✅ Auth verified:', data.user.email);

    // Reset renewal retry counter on successful auth
    renewalRetries = 0;

    // Start token renewal interval (every 10 minutes)
    window._tokenRenewalInterval = setInterval(() => renewToken(), RENEWAL_INTERVAL_MS);
  } catch (err) {
    console.error('Auth check failed:', err);
    // Only redirect if it's a 401, for other errors retry after 1 second
    if (err.message.includes('401')) {
      window.location.href = '/admin/login.html';
    } else {
      showToast('Erreur d\'authentification: ' + err.message, true);
      setTimeout(checkAuth, 1000);
    }
  }
}

export async function renewToken() {
  // Prevent concurrent renewal attempts (race condition)
  if (renewalInProgress) {
    console.warn('Token renewal already in progress');
    return;
  }

  // Check TTL before attempting renewal
  const authToken = getState('authToken');
  if (!authToken) {
    console.warn('No auth token found, cannot renew');
    window.location.href = '/admin/login.html';
    return;
  }

  renewalInProgress = true;

  try {
    const res = await fetch(window.location.origin + '/api/auth/admin-renew', {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        console.error('Token renewal rejected (401) - session may have expired');
        window.location.href = '/admin/login.html';
        return;
      }
      throw new Error(`Renewal failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data.token || !data.csrfToken) {
      throw new Error('Invalid renewal response format');
    }

    setState('authToken', data.token);
    setState('csrfToken', data.csrfToken);
    localStorage.setItem('csrfToken', data.csrfToken);
    renewalRetries = 0; // Reset retry counter on success
    console.log('🔄 Token renewed at', new Date().toLocaleTimeString());
  } catch (err) {
    console.error('Token renewal error:', err);
    renewalRetries++;

    // If max retries exceeded, log out
    if (renewalRetries >= MAX_RENEWAL_RETRIES) {
      console.error('Max renewal retries reached, logging out');
      window.location.href = '/admin/login.html';
    } else {
      console.warn(`Token renewal attempt ${renewalRetries}/${MAX_RENEWAL_RETRIES} failed, will retry`);
      // Retry after exponential backoff (1s, 2s, 4s)
      setTimeout(() => renewToken(), Math.pow(2, renewalRetries - 1) * 1000);
    }
  } finally {
    renewalInProgress = false;
  }
}

export async function logout() {
  try {
    // Clear token renewal interval
    if (window._tokenRenewalInterval) {
      clearInterval(window._tokenRenewalInterval);
      window._tokenRenewalInterval = null;
    }

    await apiCall('/auth/logout', { method: 'POST' });
    resetState();
    window.location.href = '/admin/login.html';
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
    // Still redirect even if logout API fails
    resetState();
    window.location.href = '/admin/login.html';
  }
}

// ════════════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ════════════════════════════════════════════════════════════════

export function showPage(pageId, navItem) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  // Show selected page
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.classList.add('active');
  }

  // Update nav-item active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  if (navItem) {
    navItem.classList.add('active');
  }

  // Update page title in topbar
  const pageTitle = document.querySelector('.topbar-title');
  if (pageTitle && navItem) {
    pageTitle.textContent = navItem.textContent.trim();
  }

  // Load page data
  let moduleName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
  // Map special cases
  if (moduleName === 'Dashboard') moduleName = 'KPIs';
  const module = window[moduleName];
  if (module && typeof module.load === 'function') {
    module.load(1);
  }

  console.log(`📄 Navigated to: ${pageId}`);
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD LOADER
// ════════════════════════════════════════════════════════════════

export async function loadDashboard() {
  try {
    // Use KPIs module which has proper dashboard loading logic
    await KPIs.load(1);
    console.log('✅ Dashboard loaded');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

// ════════════════════════════════════════════════════════════════
// PAGE REFRESH & EXPORT FUNCTIONS
// ════════════════════════════════════════════════════════════════

export function refreshCurrentPage() {
  const currentPageId = document.querySelector('.page.active')?.id;
  if (!currentPageId) {
    showToast('Aucune page active', true);
    return;
  }

  const pageName = currentPageId.replace('page-', '');
  let moduleName = pageName.charAt(0).toUpperCase() + pageName.slice(1);
  // Map special cases
  if (moduleName === 'Dashboard') moduleName = 'KPIs';
  const moduleFunction = window[moduleName];

  if (moduleFunction && typeof moduleFunction.load === 'function') {
    moduleFunction.load(1);
    showToast('✅ Page actualisée');
  } else {
    showToast('Refresh non disponible pour cette page', true);
  }
}

export function exportCurrentPage() {
  const currentPageId = document.querySelector('.page.active')?.id;
  if (!currentPageId) {
    showToast('Aucune page active', true);
    return;
  }

  const pageName = currentPageId.replace('page-', '');
  let moduleName = pageName.charAt(0).toUpperCase() + pageName.slice(1);
  // Map special cases
  if (moduleName === 'Dashboard') moduleName = 'KPIs';
  const moduleFunction = window[moduleName];

  if (moduleFunction && typeof moduleFunction.export === 'function') {
    moduleFunction.export();
  } else {
    showToast('Export non disponible pour cette page', true);
  }
}

// ════════════════════════════════════════════════════════════════
// AUTO-INIT ON PAGE LOAD
// ════════════════════════════════════════════════════════════════

// Only init dashboard on index.html (not login.html)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.href.includes('login')) {
      initDashboard();
    }
  });
} else {
  if (!window.location.href.includes('login')) {
    initDashboard();
  }
}

console.log('✨ Dashboard refactor complete: 21 modules + orchestrator');
