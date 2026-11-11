// Dashboard KPIs Advanced Module - KPI widgets avec sparklines
import { apiCall } from './api.js';
import { showToast } from './ui.js';

export async function loadAdvancedKPIs() {
  try {
    const res = await apiCall('/admin/dashboard/kpis-advanced');
    const { revenue, users, projects, disputes } = res;

    // Revenue trend card
    document.getElementById('kpi-revenue-trend').innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${(revenue.current || 0).toLocaleString('fr-FR')} XOF</div>
      <div style="font-size:11px;color:${revenue.trend > 0 ? '#22C55E' : '#EF4444'};">${revenue.trend > 0 ? '📈' : '📉'} ${Math.abs(revenue.trend)}% vs dernier mois</div>`;

    document.getElementById('kpi-users-trend').innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${users.current || 0}</div>
      <div style="font-size:11px;color:${users.trend > 0 ? '#22C55E' : '#EF4444'};">${users.trend > 0 ? '📈' : '📉'} ${Math.abs(users.trend)}%</div>`;

    document.getElementById('kpi-projects-trend').innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${projects.current || 0}</div>
      <div style="font-size:11px;color:${projects.trend > 0 ? '#22C55E' : '#EF4444'};">${projects.trend > 0 ? '📈' : '📉'} ${Math.abs(projects.trend)}%</div>`;

    document.getElementById('kpi-disputes-trend').innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${disputes.current || 0}</div>
      <div style="font-size:11px;color:${disputes.trend < 0 ? '#22C55E' : '#EF4444'};">${disputes.trend < 0 ? '✅' : '⚠️'} ${Math.abs(disputes.trend)}%</div>`;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Advanced KPIs loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const DashboardKPIsAdvanced = {
  loadAdvancedKPIs,
};
