// Moderation Module
// Handle content reporting, sanctions, and moderation actions

import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml } from './ui.js';

export async function loadModeration(page = 1) {
  try {
    const search = document.getElementById('moderation-search')?.value || '';
    const status = document.getElementById('mod-status-filter')?.value || '';
    const dateFrom = document.getElementById('mod-date-from')?.value || '';
    const dateTo = document.getElementById('mod-date-to')?.value || '';

    let url = '/admin/moderation/reports?page=' + page + '&limit=50';
    if (status) url += '&status=' + status;
    if (search) url += '&search=' + encodeURIComponent(search);
    if (dateFrom) url += '&dateFrom=' + dateFrom;
    if (dateTo) url += '&dateTo=' + dateTo;

    const res = await apiCall(url);
    const { reports = [], total = 0, totalPages = 1 } = res;

    setState('modCurrentPage', page);

    let html = '';
    if (reports.length === 0) {
      document.getElementById('mod-empty').style.display = 'block';
      document.getElementById('mod-tbody').innerHTML = '';
    } else {
      document.getElementById('mod-empty').style.display = 'none';
      html = reports.map(r => {
        const typeLabel = { REVIEW: '⭐ Avis', COMMENT: '💬 Commentaire', PORTFOLIO: '🖼️ Portfolio' }[r.contentType] || r.contentType;
        const statusBadge = {
          PENDING: '<span class="badge" style="background:var(--red-dim);color:var(--red);">⏳ En attente</span>',
          DISMISSED: '<span class="badge" style="background:var(--green-dim);color:var(--green);">✅ Ignoré</span>',
          REMOVED: '<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--muted);">🗑️ Supprimé</span>',
        }[r.status] || r.status;

        return `<tr onclick="window.Moderation.openModerationModal('${r.id}')" style="cursor:pointer;">
          <td>${typeLabel}</td>
          <td>${escHtml(r.content?.text?.substring(0, 50) || '')}</td>
          <td>${escHtml(r.content?.authorName || '')}</td>
          <td>${escHtml(r.reason)}</td>
          <td>${escHtml(r.reporter?.email || '')}</td>
          <td>${new Date(r.createdAt).toLocaleDateString('fr-FR')}</td>
          <td>${statusBadge}</td>
        </tr>`;
      }).join('');
      document.getElementById('mod-tbody').innerHTML = html;
    }

    // Pagination
    let paginationHtml = '';
    if (totalPages > 1) {
      if (page > 1) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Moderation.loadModeration(1)">⏮️ Première</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Moderation.loadModeration(${page - 1})">◀️ Précédente</button>`;
      }
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${page} / ${totalPages}</span>`;
      if (page < totalPages) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Moderation.loadModeration(${page + 1})">Suivante ▶️</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Moderation.loadModeration(${totalPages})">Dernière ⏭️</button>`;
      }
    }
    document.getElementById('mod-pagination').innerHTML = paginationHtml;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openModerationModal(reportId) {
  const currentReportId = reportId;
  setState('currentReportId', currentReportId);

  try {
    // Single API call: gets report + content + author history (N+1 fix)
    const r = await apiCall('/admin/moderation/reports/' + reportId);
    if (!r) {
      showToast('Signalement introuvable', true);
      return;
    }

    const c = r.content;
    setState('_moderationAuthorId', c?.authorId || null);

    const typeLabel = { REVIEW: '⭐ Avis', COMMENT: '💬 Commentaire', PORTFOLIO: '🖼️ Portfolio' };
    const statusBadge = {
      PENDING: '<span class="badge" style="background:var(--red-dim);color:var(--red);">⏳ En attente</span>',
      DISMISSED: '<span class="badge" style="background:var(--green-dim);color:var(--green);">✅ Ignoré</span>',
      REMOVED: '<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--muted);">🗑️ Supprimé</span>',
    };

    const contentHtml = c ? `
      <div style="background:var(--dark4);border-radius:12px;padding:16px;margin-bottom:12px;">
        ${r.contentType === 'REVIEW' ? '<div style="font-size:18px;color:var(--yellow);margin-bottom:6px;">★'.repeat(c.rating || 0) + '☆'.repeat(5 - (c.rating || 0)) + '</div>' : ''}
        <p style="font-size:14px;color:var(--light);line-height:1.6;margin-bottom:8px;">${escHtml(c.text || '(sans texte)')}</p>
        <div style="font-size:12px;color:var(--muted);">Auteur: <strong>${escHtml(c.authorName || '?')}</strong></div>
      </div>
    ` : '<div style="color:var(--muted);">⚠️ Contenu introuvable</div>';

    const authorName = c?.authorName || 'Auteur inconnu';
    document.getElementById('mod-author-name').textContent = authorName;
    document.getElementById('mod-sanction-error').style.display = 'none';

    // Render author history directly from API response (no separate call)
    const historyHtml = renderAuthorHistory(r.authorHistory);

    document.getElementById('mod-modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Type</div>
          <div style="font-size:14px;font-weight:600;">${typeLabel[r.contentType] || r.contentType}</div>
        </div>
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Statut</div>
          ${statusBadge[r.status] || r.status}
        </div>
      </div>
      ${contentHtml}
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--dark3);">
        <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:8px;">Historique auteur</div>
        <div id="mod-author-history">${historyHtml}</div>
      </div>
    `;

    document.getElementById('mod-dismiss-btn').style.display = r.status === 'PENDING' ? '' : 'none';
    document.getElementById('mod-remove-btn').style.display = r.status === 'PENDING' ? '' : 'none';

    openModal('modal-moderation');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

// Helper: render author history from API response (no separate fetch needed)
function renderAuthorHistory(authorHistory) {
  if (!authorHistory || authorHistory.total === 0) {
    return '✅ Aucun signalement en 30 jours';
  }

  const total = authorHistory.total;
  const typeLabels = { REVIEW: 'Avis', COMMENT: 'Commentaires', PORTFOLIO: 'Portfolio' };
  const typesStr = Object.entries(authorHistory.types || {})
    .map(([t, c]) => (typeLabels[t] || t) + ' (' + c + ')')
    .join(', ');

  const alertColor = total >= 3 ? 'var(--red)' : (total >= 1 ? 'var(--orange)' : 'var(--green)');
  const icon = total >= 3 ? '🚨' : (total >= 2 ? '⚠️' : '📌');

  return `<span style="color:${alertColor};font-weight:600;">${icon} ${total} signalement(s)</span><br>
          <span style="font-size:11px;color:var(--muted);margin-top:4px;display:block;">${typesStr}</span>`;
}

export async function moderationAction(action) {
  const reportId = getState('currentReportId');
  if (!reportId) return;

  const label = action === 'remove' ? 'supprimer définitivement le contenu' : 'ignorer ce signalement';
  if (!confirm('Confirmer : ' + label + ' ?')) return;

  try {
    await apiCall('/admin/moderation/reports/' + reportId + '/' + action, { method: 'PATCH' });
    closeModal('modal-moderation');
    showToast(action === 'remove' ? '🗑️ Contenu supprimé' : '✅ Signalement ignoré');
    await loadModeration(getState('modCurrentPage'));
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function sanctionAuthor(sanctionType) {
  const authorId = getState('_moderationAuthorId');
  const reportId = getState('currentReportId');

  if (!authorId) {
    document.getElementById('mod-sanction-error').textContent = 'Auteur introuvable';
    document.getElementById('mod-sanction-error').style.display = 'block';
    return;
  }

  const labels = {
    warn: 'avertir cet utilisateur',
    suspend: 'suspendre cet utilisateur pour 7 jours',
    ban: 'bannir définitivement cet utilisateur',
  };

  if (!confirm(`Confirmer : ${labels[sanctionType]} ?\n\nCette action ne peut pas être annulée.`)) return;

  const errEl = document.getElementById('mod-sanction-error');
  errEl.style.display = 'none';

  try {
    const endpoint = sanctionType === 'warn'
      ? '/admin/moderation/sanction/warn'
      : sanctionType === 'suspend'
        ? '/admin/moderation/sanction/suspend'
        : '/admin/moderation/sanction/ban';

    await apiCall(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        userId: authorId,
        reportId: reportId,
        reason: 'Sanction suite à signalement de contenu',
      }),
    });

    const messages = {
      warn: '⚠️ Utilisateur averti',
      suspend: '⏸️ Utilisateur suspendu pour 7 jours',
      ban: '🚫 Utilisateur banni définitivement',
    };

    showToast(messages[sanctionType]);
    closeModal('modal-moderation');
    await loadModeration(getState('modCurrentPage'));
  } catch (err) {
    errEl.textContent = 'Erreur: ' + err.message;
    errEl.style.display = 'block';
  }
}

// Deprecated: loadModerationAuthorHistory has been integrated into openModerationModal
// via the N+1 fix. Author history is now fetched in parallel with content in a single API call.

export const Moderation = {
  loadModeration,
  openModerationModal,
  moderationAction,
  sanctionAuthor,
};
