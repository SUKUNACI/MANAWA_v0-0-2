// API Rate Limits Module - Configuration limites API par endpoint
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml } from './ui.js';

export async function loadRateLimits() {
  try {
    const res = await apiCall('/admin/api/rate-limits');
    const { limits = [] } = res;

    let html = limits.length === 0 ? '' : limits.map(l => {
      return `<tr onclick="window.APIRateLimits.openLimitDetail('${l.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(l.endpoint)}</strong></td>
        <td style="padding:10px 12px;text-align:center;"><strong>${l.requestsPerMinute}</strong>/min</td>
        <td style="padding:10px 12px;text-align:center;"><strong>${l.burstSize}</strong></td>
        <td style="padding:10px 12px;font-size:11px;">${l.enabled ? '✅' : '❌'}</td>
      </tr>`;
    }).join('');

    document.getElementById('rate-limits-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openLimitDetail(limitId) {
  try {
    const res = await apiCall('/admin/api/rate-limits/' + limitId);
    if (!res) return;

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Endpoint</div>
        <div style="font-size:12px;font-family:monospace;font-weight:600;word-break:break-all;">${escHtml(res.endpoint)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Requêtes/min</div>
        <div style="font-size:16px;font-weight:700;">${res.requestsPerMinute}</div>
      </div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Taille burst</div>
      <div style="font-size:12px;">${res.burstSize}</div>
    </div>`;

    document.getElementById('rate-limits-detail-modal-body').innerHTML = body;
    openModal('modal-rate-limits-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const APIRateLimits = {
  loadRateLimits,
  openLimitDetail,
};
