// Referrals Module - Gestion du parrainage (Filleuls)
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

const STATUS_LABELS = {
  PENDING: { label: '⏳ En attente', color: '#F59E0B', badge: 'badge-yellow' },
  QUALIFIED: { label: '✅ Qualifié', color: '#22C55E', badge: 'badge-green' },
  REWARDED: { label: '🎁 Récompensé', color: '#3B82F6', badge: 'badge-blue' },
};

export async function loadReferralsStats() {
  try {
    const res = await apiCall('/admin/referrals/stats');
    if (!res) return;

    document.getElementById('referrals-total').textContent = res.totalReferrals || 0;
    document.getElementById('referrals-qualified').textContent = res.qualifiedReferrals || 0;
    document.getElementById('referrals-rewarded').textContent = res.rewardedReferrals || 0;
    document.getElementById('referrals-paid').textContent = '🏆 ' + (res.totalRewardsPaid || 0).toLocaleString('fr-FR') + ' XOF';
    document.getElementById('referrals-conversion').textContent = (res.conversionRate || 0) + '%';

    // Top referrers
    if (res.topReferrers && res.topReferrers.length > 0) {
      const topHtml = res.topReferrers.map((r, i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.02);border-radius:6px;margin-bottom:6px;">
        <div style="font-weight:700;color:var(--gold);min-width:20px;">#${i + 1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.firstName + ' ' + r.lastName)}</div>
          <div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.email)}</div>
        </div>
        <div style="font-weight:700;color:var(--orange);">${r.count}</div>
      </div>`).join('');
      document.getElementById('referrals-top-referrers').innerHTML = topHtml;
    }

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Referrals stats loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function loadReferralsList(page = 1) {
  try {
    const search = document.getElementById('referrals-search')?.value || '';
    const status = document.getElementById('referrals-status')?.value || '';

    let url = '/admin/referrals/list?page=' + page + '&limit=50';
    if (search) url += '&search=' + encodeURIComponent(search);
    if (status) url += '&status=' + status;

    const res = await apiCall(url);
    const { referrals = [], total = 0, page: currentPage = 1, totalPages = 1 } = res;

    let html = referrals.length === 0 ? '' : referrals.map(r => {
      const statusInfo = STATUS_LABELS[r.status] || { label: r.status, color: '#999' };
      const referrerName = r.referrer ? `${r.referrer.firstName} ${r.referrer.lastName}` : '—';
      const referredName = r.referred ? `${r.referred.firstName} ${r.referred.lastName}` : '—';

      return `<tr onclick="window.Referrals.openReferralDetail('${r.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(r.code)}</strong></td>
        <td style="padding:10px 12px;font-size:12px;">
          <strong>${escHtml(referrerName)}</strong><br>
          <span style="color:var(--muted);font-size:11px;">${escHtml(r.referrer?.email || '')}</span>
        </td>
        <td style="padding:10px 12px;font-size:12px;">
          <strong>${escHtml(referredName)}</strong><br>
          <span style="color:var(--muted);font-size:11px;">${escHtml(r.referred?.email || '')}</span>
        </td>
        <td style="padding:10px 12px;font-size:12px;text-align:center;">
          <span style="display:inline-block;background:${statusInfo.color};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${statusInfo.label}</span>
        </td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(r.createdAt)}</td>
        <td style="padding:10px 12px;font-size:12px;text-align:center;">
          ${r.rewardValue ? `<strong>${r.rewardValue} XOF</strong>` : '—'}
        </td>
      </tr>`;
    }).join('');

    document.getElementById('referrals-list-tbody').innerHTML = html;
    document.getElementById('referrals-list-empty').style.display = referrals.length === 0 ? 'block' : 'none';

    let paginationHtml = '';
    if (totalPages > 1) {
      if (currentPage > 1) paginationHtml += `<button class="btn btn-secondary" onclick="window.Referrals.loadReferralsList(1)">⏮️ Première</button><button class="btn btn-secondary" onclick="window.Referrals.loadReferralsList(${currentPage - 1})">◀️ Précédente</button>`;
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;
      if (currentPage < totalPages) paginationHtml += `<button class="btn btn-secondary" onclick="window.Referrals.loadReferralsList(${currentPage + 1})">Suivante ▶️</button><button class="btn btn-secondary" onclick="window.Referrals.loadReferralsList(${totalPages})">Dernière ⏭️</button>`;
    }
    document.getElementById('referrals-list-pagination').innerHTML = paginationHtml;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openReferralDetail(referralId) {
  setState('_currentReferralId', referralId);
  try {
    // Fetch only the specific referral instead of 1000 items (efficiency fix)
    const res = await apiCall('/admin/referrals/' + referralId);
    const referral = res;
    if (!referral) { showToast('Referral introuvable', true); return; }

    const statusInfo = STATUS_LABELS[referral.status] || { label: referral.status, color: '#999' };

    const body = `<div style="margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Code de parrainage</div>
      <div style="font-size:16px;font-weight:700;font-family:monospace;color:var(--orange);">${escHtml(referral.code)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Parrain</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(referral.referrer?.firstName + ' ' + referral.referrer?.lastName)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(referral.referrer?.email)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Filleul</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(referral.referred?.firstName + ' ' + referral.referred?.lastName)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(referral.referred?.email)}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Statut</div>
      <div style="display:inline-block;background:${statusInfo.color};color:#fff;padding:6px 12px;border-radius:6px;font-weight:600;">${statusInfo.label}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Créé</div>
        <div style="font-size:12px;font-weight:600;">${formatDate(referral.createdAt)}</div>
      </div>
      ${referral.qualifiedAt ? `<div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Qualifié</div>
        <div style="font-size:12px;font-weight:600;">${formatDate(referral.qualifiedAt)}</div>
      </div>` : ''}
      ${referral.rewardedAt ? `<div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Récompensé</div>
        <div style="font-size:12px;font-weight:600;">${formatDate(referral.rewardedAt)}</div>
      </div>` : ''}
    </div>

    ${referral.rewardValue ? `<div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Récompense</div>
      <div style="font-size:16px;font-weight:700;color:var(--green);">${referral.rewardValue} XOF</div>
      <div style="font-size:11px;color:var(--muted);">${referral.rewardType || 'Bonus'}</div>
    </div>` : ''}`;

    document.getElementById('referrals-modal-body').innerHTML = body;

    let actionButtons = '';
    if (referral.status === 'PENDING') {
      actionButtons = `
        <button class="btn btn-approve" onclick="window.Referrals.updateReferralStatus('QUALIFIED')" style="flex:1;">✅ Qualifier</button>
      `;
    } else if (referral.status === 'QUALIFIED') {
      actionButtons = `
        <button class="btn btn-approve" onclick="window.Referrals.openRewardDialog()" style="flex:1;">🎁 Récompenser</button>
      `;
    }
    document.getElementById('referrals-modal-actions').innerHTML = actionButtons || '<button class="btn btn-secondary" onclick="closeModal(\'modal-referral\')" style="flex:1;">Fermer</button>';

    openModal('modal-referral');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function updateReferralStatus(newStatus) {
  const referralId = getState('_currentReferralId');
  if (!referralId) return;

  if (!confirm(`Changer le statut à ${newStatus}?`)) return;

  try {
    await apiCall('/admin/referrals/' + referralId + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });

    showToast(`✅ Referral mis à jour`);
    await loadReferralsList(1);
    closeModal('modal-referral');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openRewardDialog() {
  const html = `<div style="margin-bottom:16px;">
    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">Montant de la récompense (XOF)</label>
    <input type="number" id="reward-value" class="filter-input" placeholder="5000" min="0" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--light);font-family:'DM Sans',sans-serif;font-size:12px;">
  </div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">Type de récompense</label>
    <select id="reward-type" class="filter-select" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--light);font-family:'DM Sans',sans-serif;font-size:12px;">
      <option value="Bonus">Bonus</option>
      <option value="Crédit">Crédit</option>
      <option value="Premium">Accès Premium</option>
      <option value="Autre">Autre</option>
    </select>
  </div>`;

  document.getElementById('reward-dialog-body').innerHTML = html;
  openModal('modal-reward-dialog');
}

export async function confirmReward() {
  const referralId = getState('_currentReferralId');
  const rewardValue = document.getElementById('reward-value')?.value;
  const rewardType = document.getElementById('reward-type')?.value;

  if (!rewardValue || isNaN(parseFloat(rewardValue))) {
    showToast('Montant invalide', true);
    return;
  }

  if (!confirm(`Récompenser avec ${rewardValue} XOF (${rewardType})?`)) return;

  try {
    await apiCall('/admin/referrals/' + referralId + '/status', {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'REWARDED',
        rewardType: rewardType,
        rewardValue: parseFloat(rewardValue),
      }),
    });

    showToast(`✅ Récompense de ${rewardValue} XOF versée`);
    await loadReferralsList(1);
    closeModal('modal-reward-dialog');
    closeModal('modal-referral');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function debounceLoadReferrals() {
  clearTimeout(window._referralsSearchTimer);
  window._referralsSearchTimer = setTimeout(() => loadReferralsList(1), 300);
}

export async function loadReferrals(page = 1) {
  try {
    await Promise.all([
      loadReferralsStats(),
      loadReferralsList(page),
    ]);
  } catch (err) {
    showToast('Erreur chargement referrals: ' + err.message, true);
  }
}

export const Referrals = {
  load: loadReferrals,
  loadReferralsStats,
  loadReferralsList,
  openReferralDetail,
  updateReferralStatus,
  openRewardDialog,
  confirmReward,
  debounceLoadReferrals,
};
