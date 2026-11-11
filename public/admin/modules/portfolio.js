// Portfolio Module - Réalisations & Portfolio Management
import { apiCall, loadModuleTable } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

const STATUS_DISPLAY = {
  APPROVED: { label: '✅ Approuvé', color: '#22C55E' },
  PENDING: { label: '⏳ En attente', color: '#F59E0B' },
  REJECTED: { label: '❌ Rejeté', color: '#EF4444' },
};

export async function loadPortfolio(page = 1) {
  const result = await loadModuleTable({
    endpoint: '/api/portfolio-projects?page={page}&limit={limit}',
    selector: {
      tbody: 'portfolio-tbody',
      empty: 'portfolio-empty',
      pagination: 'portfolio-pagination',
    },
    columns: [
      {
        key: 'title',
        label: 'Réalisation',
        render: (val, row) => {
          const proName = row.professional
            ? `${row.professional.firstName} ${row.professional.lastName}`
            : '—';
          return `<strong>${escHtml(val)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(proName)}</span>`;
        },
      },
      {
        key: 'description',
        label: 'Description',
        render: (val) => escHtml((val || '').substring(0, 50)),
      },
      {
        key: 'status',
        label: 'Statut',
        render: (val) => {
          const display = STATUS_DISPLAY[val] || { label: val, color: '#999' };
          return `<span style="display:inline-block;background:${display.color};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${display.label}</span>`;
        },
      },
      { key: 'createdAt', label: 'Date', render: (val) => formatDate(val) },
    ],
    filters: [{ key: 'status', input: 'portfolio-status' }],
  }, page);

  updateBulkActions();
  return result;
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
