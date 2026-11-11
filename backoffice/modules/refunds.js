// Refunds & Credits Module - Gestion des remboursements et avoirs
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

export async function loadRefundRequests(page = 1) {
  try {
    const res = await apiCall('/admin/refunds/requests?page=' + page);
    const { requests = [], total = 0, pages = 0 } = res;

    let html = requests.length === 0 ? '' : requests.map(r => {
      const statusColor = r.status === 'approved' ? '#22C55E' : r.status === 'rejected' ? '#EF4444' : '#F59E0B';
      const statusLabel = r.status === 'approved' ? '✅ Approuvé' : r.status === 'rejected' ? '❌ Refusé' : '⏳ En attente';

      return `<tr onclick="window.Refunds.openRefundDetail('${r.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(r.client?.firstName || '')} ${escHtml(r.client?.lastName || '')}</strong></td>
        <td style="padding:10px 12px;text-align:right;font-size:12px;"><strong>${(r.amount || 0).toLocaleString('fr-FR')} XOF</strong></td>
        <td style="padding:10px 12px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.reason || '—')}</td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${statusColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${statusLabel}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(r.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('refunds-tbody').innerHTML = html;
    document.getElementById('refunds-empty').style.display = requests.length === 0 ? 'block' : 'none';
    document.getElementById('refunds-total').textContent = total;

    // Pagination
    let pageHtml = '';
    for (let i = 1; i <= pages; i++) {
      pageHtml += `<button onclick="window.Refunds.loadRefundRequests(${i})" style="margin:0 2px;padding:6px 12px;background:${page === i ? '#3B82F6' : 'var(--dark4)'};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">${i}</button>`;
    }
    document.getElementById('refunds-pagination').innerHTML = pageHtml;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Refund requests loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openRefundDetail(refundId) {
  setState('_currentRefundId', refundId);
  try {
    const res = await apiCall('/admin/refunds/' + refundId);
    if (!res) { showToast('Remboursement introuvable', true); return; }

    const statusColor = res.status === 'approved' ? '#22C55E' : res.status === 'rejected' ? '#EF4444' : '#F59E0B';
    const statusLabel = res.status === 'approved' ? '✅ Approuvé' : res.status === 'rejected' ? '❌ Refusé' : '⏳ En attente';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Client</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(res.client?.firstName || '')} ${escHtml(res.client?.lastName || '')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Montant</div>
        <div style="font-size:16px;font-weight:700;">${(res.amount || 0).toLocaleString('fr-FR')} XOF</div>
      </div>
    </div>

    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Raison</div>
      <div style="font-size:12px;color:var(--light);">${escHtml(res.reason || '—')}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Statut</div>
        <div style="display:inline-block;background:${statusColor};color:#fff;padding:6px 12px;border-radius:4px;font-size:11px;font-weight:600;">${statusLabel}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Date demande</div>
        <div style="font-size:12px;">${formatDate(res.createdAt)}</div>
      </div>
    </div>

    ${res.status === 'pending' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
      <button onclick="window.Refunds.approveRefund('${res.id}')" style="padding:10px;background:#22C55E;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✅ Approuver</button>
      <button onclick="window.Refunds.rejectRefund('${res.id}')" style="padding:10px;background:#EF4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">❌ Refuser</button>
    </div>` : ''}`;

    document.getElementById('refunds-modal-body').innerHTML = body;
    openModal('modal-refund-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function approveRefund(refundId) {
  if (!confirm('Approuver ce remboursement?')) return;

  try {
    await apiCall('/admin/refunds/' + refundId + '/approve', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Remboursement approuvé');
    closeModal('modal-refund-detail');
    await loadRefundRequests(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function rejectRefund(refundId) {
  const reason = prompt('Motif du refus:');
  if (!reason) return;

  try {
    await apiCall('/admin/refunds/' + refundId + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    showToast('✅ Remboursement refusé');
    closeModal('modal-refund-detail');
    await loadRefundRequests(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Refunds = {
  loadRefundRequests,
  openRefundDetail,
  approveRefund,
  rejectRefund,
};
