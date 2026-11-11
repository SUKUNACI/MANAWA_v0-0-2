// Subscriptions Detail Module - Plans de souscription détail
import { apiCall } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

export async function loadSubscriptionPlans() {
  try {
    const res = await apiCall('/admin/subscriptions/plans');
    const { plans = [] } = res;

    let html = plans.length === 0 ? '' : plans.map(p => {
      const usersCount = p.activeUsers || 0;
      const revenue = (p.mrr || 0).toLocaleString('fr-FR');

      return `<tr onclick="window.SubscriptionsDetail.openPlanDetail('${p.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(p.name)}</strong></td>
        <td style="padding:10px 12px;text-align:right;"><strong>${(p.price || 0).toLocaleString('fr-FR')} XOF</strong></td>
        <td style="padding:10px 12px;text-align:center;"><strong>${usersCount}</strong></td>
        <td style="padding:10px 12px;text-align:right;"><strong>${revenue} XOF/mois</strong></td>
      </tr>`;
    }).join('');

    document.getElementById('subscriptions-plans-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openPlanDetail(planId) {
  try {
    const res = await apiCall('/admin/subscriptions/plans/' + planId);
    if (!res) return;

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Plan</div>
        <div style="font-size:14px;font-weight:700;">${escHtml(res.name)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Utilisateurs actifs</div>
        <div style="font-size:16px;font-weight:700;">${res.activeUsers || 0}</div>
      </div>
    </div>`;

    document.getElementById('subscriptions-detail-modal-body').innerHTML = body;
    openModal('modal-subscriptions-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const SubscriptionsDetail = {
  loadSubscriptionPlans,
  openPlanDetail,
};
