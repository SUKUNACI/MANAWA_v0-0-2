// Fraud Detection Dashboard Module - Anomalies & pattern detection
import { apiCall } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

export async function loadFraudAlerts() {
  try {
    const res = await apiCall('/admin/fraud/alerts');
    const { alerts = [] } = res;

    let html = alerts.length === 0 ? '' : alerts.map(a => {
      const severityColor = a.severity === 'critical' ? '#EF4444' : a.severity === 'high' ? '#F59E0B' : '#3B82F6';
      const severityLabel = a.severity === 'critical' ? '🔴 Critique' : a.severity === 'high' ? '🟠 Élevé' : '🔵 Moyen';

      return `<tr onclick="window.FraudDetection.openAlertDetail('${a.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(a.type)}</strong></td>
        <td style="padding:10px 12px;"><span style="display:inline-block;background:${severityColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${severityLabel}</span></td>
        <td style="padding:10px 12px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escHtml(a.description || '—')}</td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(a.detectedAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('fraud-alerts-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openAlertDetail(alertId) {
  try {
    const res = await apiCall('/admin/fraud/alerts/' + alertId);
    if (!res) { showToast('Alerte introuvable', true); return; }

    const severityColor = res.severity === 'critical' ? '#EF4444' : res.severity === 'high' ? '#F59E0B' : '#3B82F6';
    const severityLabel = res.severity === 'critical' ? '🔴 Critique' : res.severity === 'high' ? '🟠 Élevé' : '🔵 Moyen';

    const body = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Type</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(res.type)}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Sévérité</div>
      <div style="display:inline-block;background:${severityColor};color:#fff;padding:6px 12px;border-radius:4px;font-size:11px;font-weight:600;">${severityLabel}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Description</div>
      <div style="font-size:12px;line-height:1.5;">${escHtml(res.description || '')}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Détecté à</div>
      <div style="font-size:11px;">${formatDate(res.detectedAt)}</div>
    </div>`;

    document.getElementById('fraud-detection-modal-body').innerHTML = body;
    openModal('modal-fraud-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const FraudDetection = {
  loadFraudAlerts,
  openAlertDetail,
};
