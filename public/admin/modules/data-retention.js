// Data Retention Policy Module - Configure purge schedules
import { apiCall } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

export async function loadRetentionPolicies() {
  try {
    const res = await apiCall('/admin/data/retention-policies');
    const { policies = [] } = res;

    let html = policies.length === 0 ? '' : policies.map(p => {
      return `<tr onclick="window.DataRetention.openPolicyDetail('${p.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(p.dataType)}</strong></td>
        <td style="padding:10px 12px;text-align:center;"><strong>${p.retentionDays}</strong> jours</td>
        <td style="padding:10px 12px;text-align:center;font-size:11px;">${p.enabled ? '✅' : '❌'}</td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(p.lastPurge || 'Jamais')}</td>
      </tr>`;
    }).join('');

    document.getElementById('retention-policies-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openPolicyDetail(policyId) {
  try {
    const res = await apiCall('/admin/data/retention-policies/' + policyId);
    if (!res) return;

    const body = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Type données</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(res.dataType)}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Jours de rétention</div>
      <div style="font-size:16px;font-weight:700;">${res.retentionDays}</div>
    </div>`;

    document.getElementById('data-retention-detail-modal-body').innerHTML = body;
    openModal('modal-data-retention-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const DataRetention = {
  loadRetentionPolicies,
  openPolicyDetail,
};
