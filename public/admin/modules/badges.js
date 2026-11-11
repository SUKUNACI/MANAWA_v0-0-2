// Badges Module - Gestion des badges artisans
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

const BADGE_TYPES = {
  FIRST_QUOTE: { label: '📄 Premier devis', color: '#3B82F6', description: 'A envoyé son premier devis' },
  FIRST_MISSION: { label: '💼 Première mission', color: '#22C55E', description: 'A complété sa première mission' },
  TEN_MISSIONS: { label: '🏆 10 missions', color: '#F4720B', description: '10 missions complétées' },
  FIFTY_MISSIONS: { label: '⭐ 50 missions', color: '#EAB308', description: '50 missions complétées' },
  TOP_RATED: { label: '👍 Très bien noté', color: '#10B981', description: 'Note moyenne ≥ 4.5 sur 10+ avis' },
  VERIFIED_ID: { label: '🛡️ Identité vérifiée', color: '#6366F1', description: 'Identité validée par MANAWA' },
  PREMIUM: { label: '⚡ Membre Premium', color: '#F59E0B', description: 'Abonnement Premium actif' },
  FAST_RESPONDER: { label: '⏱️ Réactif', color: '#06B6D4', description: 'Répond en moins de 2h' },
  PORTFOLIO_RICH: { label: '🖼️ Portfolio complet', color: '#8B5CF6', description: '10+ réalisations publiées' },
  TRUSTED: { label: '❤️ Artisan de confiance', color: '#EF4444', description: 'Score de confiance ≥ 80' },
  COMPANY: { label: '👥 Entreprise', color: '#64748B', description: 'Compte entreprise vérifié' },
  EARLY_ADOPTER: { label: '🌅 Early adopter', color: '#F97316', description: 'Parmi les 500 premiers' },
  REFERRER: { label: '🤝 Ambassadeur', color: '#EC4899', description: 'A parrainé 3+ artisans' },
};

export async function loadBadgesStats() {
  try {
    const res = await apiCall('/admin/badges/stats');
    if (!res) return;

    document.getElementById('badges-total').textContent = res.totalProfessionals || 0;
    document.getElementById('badges-with-any').textContent = res.professionalsWith || 0;
    document.getElementById('badges-avg').textContent = (res.averagePerPro || 0).toFixed(1);
    document.getElementById('badges-most-common').textContent = res.mostCommon ? BADGE_TYPES[res.mostCommon]?.label || res.mostCommon : '—';

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Badges stats loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function loadBadgesByType() {
  try {
    const res = await apiCall('/admin/badges/by-type');
    if (!res || !res.distribution) return;

    let html = '';
    Object.entries(res.distribution).forEach(([badgeKey, count]) => {
      const badge = BADGE_TYPES[badgeKey];
      if (!badge) return;
      const pct = res.totalBadges > 0 ? ((count / res.totalBadges) * 100).toFixed(1) : 0;
      html += `<tr>
        <td><span style="color:${badge.color};font-weight:600;">${badge.label}</span></td>
        <td>${count}</td>
        <td>
          <div style="background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden;height:16px;">
            <div style="background:${badge.color};width:${pct}%;height:100%;transition:width .3s;"></div>
          </div>
        </td>
        <td>${pct}%</td>
        <td>${badge.description}</td>
      </tr>`;
    });

    document.getElementById('badges-distribution-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function loadProfessionalsWithBadges(page = 1) {
  try {
    const search = document.getElementById('badges-search')?.value || '';
    const badgeFilter = document.getElementById('badges-filter')?.value || '';

    let url = '/admin/badges/professionals?page=' + page + '&limit=50';
    if (search) url += '&search=' + encodeURIComponent(search);
    if (badgeFilter) url += '&badge=' + badgeFilter;

    const res = await apiCall(url);
    const { professionals = [], total = 0, page: currentPage = 1, totalPages = 1 } = res;

    let html = professionals.length === 0 ? '' : professionals.map(p => {
      const badgeElements = (p.badges || []).map(b => {
        const badge = BADGE_TYPES[b.badgeKey];
        return `<span style="display:inline-block;background:${badge?.color || '#999'};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;margin:2px;font-weight:600;">${badge?.label || b.badgeKey}</span>`;
      }).join('');

      return `<tr onclick="window.Badges.openProfessionalBadges('${p.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(p.firstName + ' ' + p.lastName)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(p.email)}</span></td>
        <td style="padding:10px 12px;font-size:11px;text-align:center;">${p.badges?.length || 0}</td>
        <td style="padding:10px 12px;font-size:11px;">${badgeElements || '—'}</td>
        <td style="padding:10px 12px;font-size:12px;text-align:center;">
          <button class="btn btn-view" onclick="event.stopPropagation(); window.Badges.forceRecalculateBadges('${p.id}')" style="padding:4px 8px;font-size:10px;">🔄 Recalculer</button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('badges-pros-tbody').innerHTML = html;
    document.getElementById('badges-pros-empty').style.display = professionals.length === 0 ? 'block' : 'none';

    let paginationHtml = '';
    if (totalPages > 1) {
      if (currentPage > 1) paginationHtml += `<button class="btn btn-secondary" onclick="window.Badges.loadProfessionalsWithBadges(1)">⏮️ Première</button><button class="btn btn-secondary" onclick="window.Badges.loadProfessionalsWithBadges(${currentPage - 1})">◀️ Précédente</button>`;
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;
      if (currentPage < totalPages) paginationHtml += `<button class="btn btn-secondary" onclick="window.Badges.loadProfessionalsWithBadges(${currentPage + 1})">Suivante ▶️</button><button class="btn btn-secondary" onclick="window.Badges.loadProfessionalsWithBadges(${totalPages})">Dernière ⏭️</button>`;
    }
    document.getElementById('badges-pros-pagination').innerHTML = paginationHtml;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openProfessionalBadges(professionalId) {
  setState('_currentBadgesProId', professionalId);
  try {
    const pro = await apiCall('/admin/professionals/' + professionalId);
    if (!pro) { showToast('Professionnel introuvable', true); return; }

    const badges = await apiCall('/admin/badges/professional/' + professionalId);

    let badgesHtml = '';
    if (badges && badges.length > 0) {
      badgesHtml = badges.map(b => {
        const badge = BADGE_TYPES[b.badgeKey];
        return `<div style="background:${badge?.color || '#999'};color:#fff;padding:12px;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${badge?.label || b.badgeKey}</div>
          <div style="font-size:12px;opacity:.9;">${badge?.description || 'Badge personnalisé'}</div>
          <div style="font-size:10px;opacity:.7;margin-top:4px;">Débloqué: ${formatDate(b.earnedAt)}</div>
        </div>`;
      }).join('');
    } else {
      badgesHtml = '<p style="color:var(--muted);">Aucun badge pour le moment.</p>';
    }

    const body = `<div style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Professionnel</div>
      <div style="font-size:14px;font-weight:600;">${escHtml(pro.firstName + ' ' + pro.lastName)}</div>
      <div style="font-size:12px;color:var(--muted);">${escHtml(pro.email)}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;font-weight:600;">Badges (${badges?.length || 0})</div>
      ${badgesHtml}
    </div>`;

    document.getElementById('badges-modal-body').innerHTML = body;
    document.getElementById('badges-modal-actions').innerHTML = `
      <button class="btn btn-view" onclick="window.Badges.forceRecalculateBadges('${professionalId}')" style="flex:1;">🔄 Recalculer maintenant</button>
    `;

    openModal('modal-badges');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function forceRecalculateBadges(professionalId) {
  if (!confirm('Recalculer les badges pour ce professionnel?\nNouveau badges seront débloqués si conditions remplies.')) return;

  try {
    const res = await apiCall('/admin/badges/recalculate/' + professionalId, {
      method: 'POST',
    });

    if (res && res.newBadges && res.newBadges.length > 0) {
      const newLabels = res.newBadges.map(b => BADGE_TYPES[b.badgeKey]?.label || b.badgeKey).join(', ');
      showToast(`✨ ${res.newBadges.length} nouveau(x) badge(s): ${newLabels}`);
    } else {
      showToast('✅ Badges à jour (aucun nouveau)');
    }

    await openProfessionalBadges(professionalId);
    await loadProfessionalsWithBadges(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function bulkRecalculateAllBadges() {
  if (!confirm('Recalculer les badges pour TOUS les professionnels?\nCela peut prendre quelques minutes...')) return;

  try {
    showToast('⏳ Recalcul en cours pour tous les professionnels...');
    const res = await apiCall('/admin/badges/recalculate-all', {
      method: 'POST',
    });

    if (res) {
      showToast(`✅ ${res.processed || 0} professionnels traités (${res.newBadges || 0} nouveau badges)`);
    }

    await loadBadgesStats();
    await loadBadgesByType();
    await loadProfessionalsWithBadges(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function debounceLoadProfessionals() {
  clearTimeout(window._badgesSearchTimer);
  window._badgesSearchTimer = setTimeout(() => loadProfessionalsWithBadges(1), 300);
}

export const Badges = {
  loadBadgesStats,
  loadBadgesByType,
  loadProfessionalsWithBadges,
  openProfessionalBadges,
  forceRecalculateBadges,
  bulkRecalculateAllBadges,
  debounceLoadProfessionals,
};
