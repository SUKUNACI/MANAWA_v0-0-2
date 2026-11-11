// Portfolio Module - Réalisations & Portfolio Management
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadPortfolio(page = 1) {
  try {
    const status = document.getElementById('portfolio-status')?.value || '';
    let url = '/api/portfolio-projects?page=' + page + '&limit=50';
    if (status) url += '&status=' + status;

    const res = await apiCall(url);
    const { projects = [], total = 0, page: currentPage = 1, totalPages = 1 } = res;

    let html = projects.length === 0 ? '' : projects.map(p => {
      const proName = p.professional ? `${p.professional.firstName} ${p.professional.lastName}` : '—';
      const statusBadge = p.status === 'APPROVED' ? '✅ Approuvé' : p.status === 'PENDING' ? '⏳ En attente' : '❌ Rejeté';

      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
        <td style="padding:10px 12px;"><input type="checkbox" class="portfolio-checkbox" value="${p.id}" style="cursor:pointer;"></td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(p.title)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(proName)}</span></td>
        <td style="padding:10px 12px;font-size:11px;max-width:200px;">${escHtml((p.description || '').substring(0, 50))}</td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${p.status === 'APPROVED' ? '#22C55E' : p.status === 'PENDING' ? '#F59E0B' : '#EF4444'};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${statusBadge}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(p.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('portfolio-tbody').innerHTML = html;
    document.getElementById('portfolio-empty').style.display = projects.length === 0 ? 'block' : 'none';

    let paginationHtml = '';
    if (totalPages > 1) {
      if (currentPage > 1) paginationHtml += `<button class="btn btn-secondary" onclick="window.Portfolio.loadPortfolio(1)">⏮️ Première</button><button class="btn btn-secondary" onclick="window.Portfolio.loadPortfolio(${currentPage - 1})">◀️ Précédente</button>`;
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;
      if (currentPage < totalPages) paginationHtml += `<button class="btn btn-secondary" onclick="window.Portfolio.loadPortfolio(${currentPage + 1})">Suivante ▶️</button><button class="btn btn-secondary" onclick="window.Portfolio.loadPortfolio(${totalPages})">Dernière ⏭️</button>`;
    }
    document.getElementById('portfolio-pagination').innerHTML = paginationHtml;

    updateBulkActions();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function updateBulkActions() {
  const checkboxes = document.querySelectorAll('.portfolio-checkbox:checked');
  const count = checkboxes.length;
  const actionBar = document.getElementById('portfolio-bulk-actions');

  if (actionBar) {
    if (count > 0) {
      actionBar.style.display = 'flex';
      document.getElementById('portfolio-bulk-count').textContent = count;
    } else {
      actionBar.style.display = 'none';
    }
  }
}

export function togglePortfolioCheckbox() {
  updateBulkActions();
}

export async function bulkApprovePortfolio() {
  const checkboxes = document.querySelectorAll('.portfolio-checkbox:checked');
  const ids = Array.from(checkboxes).map(c => c.value);

  if (ids.length === 0) { showToast('Aucun élément sélectionné', true); return; }
  if (!confirm(`Approuver ${ids.length} réalisation(s)?`)) return;

  try {
    await apiCall('/api/portfolio-projects/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
    showToast(`✅ ${ids.length} réalisation(s) approuvée(s)`);
    await loadPortfolio(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function bulkRejectPortfolio() {
  const checkboxes = document.querySelectorAll('.portfolio-checkbox:checked');
  const ids = Array.from(checkboxes).map(c => c.value);

  if (ids.length === 0) { showToast('Aucun élément sélectionné', true); return; }
  if (!confirm(`Rejeter ${ids.length} réalisation(s)?`)) return;

  try {
    await apiCall('/api/portfolio-projects/bulk-reject', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
    showToast(`❌ ${ids.length} réalisation(s) rejetée(s)`);
    await loadPortfolio(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Portfolio = {
  loadPortfolio,
  togglePortfolioCheckbox,
  bulkApprovePortfolio,
  bulkRejectPortfolio,
  updateBulkActions,
};
