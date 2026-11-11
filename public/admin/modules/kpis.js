// KPIs Module - Extended dashboard metrics
import { apiCall } from './api.js';
import { formatDate, showToast } from './ui.js';

/**
 * Comprehensive error logging for KPI operations
 * Captures stack traces and provides context-specific error messages
 */
function logKpiError(context, error) {
  const errorMsg = error?.message || 'Unknown error';
  const errorStack = error?.stack || 'No stack trace available';

  console.error(`[KPI Error] ${context}:`, errorMsg);
  console.error(`[KPI Stack Trace] ${context}:`, errorStack);

  // Only show user-facing toast for critical failures
  showToast(`Erreur KPI (${context}): ${errorMsg}`, true);
}

/**
 * Safely update DOM element with error handling
 */
function updateKpiElement(elementId, value, formatter = null) {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`[KPI Warning] DOM element not found: ${elementId}`);
      return false;
    }

    const formattedValue = formatter ? formatter(value) : value;
    element.textContent = formattedValue;
    return true;
  } catch (err) {
    console.error(`[KPI Error] Failed to update element ${elementId}:`, err.message);
    console.error(err.stack);
    return false;
  }
}

/**
 * Safely set HTML in DOM element with error handling
 */
function setKpiHtml(elementId, html) {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`[KPI Warning] DOM element not found: ${elementId}`);
      return false;
    }

    element.innerHTML = html;
    return true;
  } catch (err) {
    console.error(`[KPI Error] Failed to set HTML in element ${elementId}:`, err.message);
    console.error(err.stack);
    return false;
  }
}

/**
 * Safely set style on DOM element with error handling
 */
function setKpiStyle(elementId, property, value) {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`[KPI Warning] DOM element not found: ${elementId}`);
      return false;
    }

    element.style[property] = value;
    return true;
  } catch (err) {
    console.error(`[KPI Error] Failed to set style on element ${elementId}:`, err.message);
    console.error(err.stack);
    return false;
  }
}

export const KPIs = {
  async load(page = 1) {
    try {
      // Load main dashboard KPIs first
      let dashRes;
      try {
        dashRes = await apiCall('/admin/dashboard');
      } catch (err) {
        logKpiError('Dashboard API call', err);
        // Continue with extended KPIs even if dashboard fails
        dashRes = null;
      }

      if (dashRes) {
        try {
          // Update main dashboard KPIs with safe element updates
          updateKpiElement('kpi-pros', dashRes.totalPros || 0);
          updateKpiElement('kpi-clients', dashRes.totalClients || 0);
          updateKpiElement('kpi-projects', dashRes.projectsOpen || 0);
          updateKpiElement('kpi-revenue', dashRes.revenue || 0, (val) => val.toLocaleString('fr-FR'));
          updateKpiElement('kpi-premium', dashRes.activePremium || 0);
          updateKpiElement('kpi-quotes', dashRes.totalQuotes || 0);
          updateKpiElement('kpi-payments-ok', dashRes.totalPayments || 0);
          updateKpiElement('kpi-promos', dashRes.activePromos || 0);
          updateKpiElement('kpi-portfolio', dashRes.portfolioProjects || 0);
        } catch (err) {
          logKpiError('Dashboard KPI DOM updates', err);
        }
      }

      // Then load extended KPIs
      try {
        await loadExtendedKPIs();
      } catch (err) {
        logKpiError('Extended KPIs load', err);
      }
    } catch (err) {
      logKpiError('KPIs main load', err);
    }
  }
};

export async function loadExtendedKPIs() {
  let res;

  try {
    res = await apiCall('/admin/kpis/extended');
  } catch (err) {
    logKpiError('Extended KPIs API call', err);
    return;
  }

  if (!res) {
    console.warn('[KPI Warning] Extended KPIs API returned null or undefined');
    return;
  }

  // Réservations ce mois
  try {
    if (res.reservations && typeof res.reservations === 'object') {
      const thisMonth = res.reservations.thisMonth || 0;
      const lastMonth = res.reservations.lastMonth || 0;

      updateKpiElement('kpi-reservations', thisMonth);

      if (lastMonth > 0) {
        try {
          const delta = ((thisMonth - lastMonth) / lastMonth * 100).toFixed(0);
          const deltaClass = delta >= 0 ? 'up' : 'warn';
          const deltaText = delta >= 0 ? `+${delta}%` : `${delta}%`;
          const html = `<span class="kpi-delta ${deltaClass}">${deltaText}</span>`;
          setKpiHtml('kpi-reservations-delta', html);
        } catch (deltaErr) {
          console.error('[KPI Error] Failed to calculate reservations delta:', deltaErr.message);
          console.error(deltaErr.stack);
        }
      }
    }
  } catch (err) {
    logKpiError('Reservations KPI update', err);
  }

  // Forfaits (Package orders ce mois)
  try {
    if (res.packageOrders && typeof res.packageOrders === 'object') {
      const thisMonth = res.packageOrders.thisMonth || 0;
      const lastMonth = res.packageOrders.lastMonth || 0;

      updateKpiElement('kpi-package-orders', thisMonth);

      if (lastMonth > 0) {
        try {
          const delta = ((thisMonth - lastMonth) / lastMonth * 100).toFixed(0);
          const deltaClass = delta >= 0 ? 'up' : 'warn';
          const deltaText = delta >= 0 ? `+${delta}%` : `${delta}%`;
          const html = `<span class="kpi-delta ${deltaClass}">${deltaText}</span>`;
          setKpiHtml('kpi-package-orders-delta', html);
        } catch (deltaErr) {
          console.error('[KPI Error] Failed to calculate package orders delta:', deltaErr.message);
          console.error(deltaErr.stack);
        }
      }
    }
  } catch (err) {
    logKpiError('Package Orders KPI update', err);
  }

  // Top pro (best rated)
  try {
    if (res.topPro && typeof res.topPro === 'object') {
      updateKpiElement('kpi-top-pro', res.topPro.rating || 0);
      updateKpiElement('kpi-top-pro-name', res.topPro.name || 'N/A');
    }
  } catch (err) {
    logKpiError('Top Pro KPI update', err);
  }

  // Croissance revenue
  try {
    if (res.revenue && typeof res.revenue === 'object') {
      const growth = res.revenue.growthPercent || 0;
      updateKpiElement('kpi-monthly-growth', growth + '%');
      setKpiStyle('kpi-monthly-growth', 'color', growth >= 0 ? 'var(--green)' : 'var(--red)');
    }
  } catch (err) {
    logKpiError('Revenue Growth KPI update', err);
  }

  // ✅ Debug logging only in debug mode
  try {
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('[KPI Debug] Extended KPIs loaded successfully');
    }
  } catch (debugErr) {
    // Silently ignore debug logging errors
  }
}
