// Insurance Module - Gestion assurance artisans
import { apiCall } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

export async function loadInsuranceData(page = 1) {
  try {
    const res = await apiCall('/admin/insurance?page=' + page);
    const { records = [], total = 0, pages = 0 } = res;

    let html = records.length === 0 ? '' : records.map(r => {
      const statusColor = r.status === 'active' ? '#22C55E' : r.status === 'expired' ? '#EF4444' : '#F59E0B';
      const status = r.status === 'active' ? '✅ Actif' : r.status === 'expired' ? '❌ Expiré' : '⏳ En attente';

      return `<tr onclick="window.Insurance.openInsuranceDetail('${r.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(r.professional?.firstName || '')}</strong></td>
        <td style="padding:10px 12px;font-size:12px;">${escHtml(r.policyNumber || '—')}</td>
        <td style="padding:10px 12px;text-align:right;"><strong>${(r.coverage || 0).toLocaleString('fr-FR')} XOF</strong></td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${statusColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;">${status}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(r.expiryDate)}</td>
      </tr>`;
    }).join('');

    document.getElementById('insurance-tbody').innerHTML = html;
    document.getElementById('insurance-total').textContent = total;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openInsuranceDetail(recordId) {
  try {
    const res = await apiCall('/admin/insurance/' + recordId);
    if (!res) { showToast('Assurance introuvable', true); return; }

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Professionnel</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.professional?.firstName || '')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Couverture</div>
        <div style="font-size:14px;font-weight:700;">${(res.coverage || 0).toLocaleString('fr-FR')} XOF</div>
      </div>
    </div>`;

    document.getElementById('insurance-modal-body').innerHTML = body;
    openModal('modal-insurance');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Insurance = {
  loadInsuranceData,
  openInsuranceDetail,
};
