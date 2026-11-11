// Disputes Module - Litiges avec timeline et notifications
import { apiCall, loadModuleTable, debounceModuleTableSearch } from './api.js';
import { setState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

const STATUS_BADGES = {
  PENDING: '⏳ En attente',
  UNDER_REVIEW: '🔍 En examen',
  RESOLVED_REFUND: '✅ Remboursé',
  RESOLVED_PARTIAL: '⚠️ Partiel',
  RESOLVED_REJECTED: '❌ Rejeté',
};

export async function loadDisputes(page = 1) {
  return loadModuleTable({
    endpoint: '/admin/disputes?page={page}&limit={limit}',
    selector: {
      tbody: 'disputes-tbody',
      pagination: 'disputes-pagination',
    },
    columns: [
      {
        key: 'client',
        label: 'Client',
        render: (val) => escHtml(val.firstName + ' ' + val.lastName),
      },
      {
        key: 'professional',
        label: 'Professionnel',
        render: (val) => escHtml(val.firstName + ' ' + val.lastName),
      },
      {
        key: 'amount',
        label: 'Montant',
        render: (val) => val.toLocaleString('fr-FR') + ' XOF',
      },
      { key: 'reason', label: 'Raison', render: (val) => escHtml(val) },
      {
        key: 'status',
        label: 'Statut',
        render: (val) => STATUS_BADGES[val] || val,
      },
      { key: 'createdAt', label: 'Date', render: (val) => formatDate(val) },
    ],
    onRowClick: (row) => window.Disputes.openDisputeModal(row.id),
    filters: [{ key: 'status', input: 'disputes-status' }],
  }, page);
}

export async function openDisputeModal(disputeId) {
  setState('currentDisputeId', disputeId);
  try {
    const dispute = await apiCall('/admin/disputes/' + disputeId);
    if (!dispute) { showToast('Litige introuvable', true); return; }

    const body = `<div style="font-size:14px;">
      <p>Client: ${escHtml(dispute.client.firstName)} ${escHtml(dispute.client.lastName)}</p>
      <p>Professionnel: ${escHtml(dispute.professional.firstName)} ${escHtml(dispute.professional.lastName)}</p>
      <p>Montant: ${dispute.amount.toLocaleString('fr-FR')} XOF</p>
      <p>Raison: ${escHtml(dispute.reason)}</p>
      <p>Statut: ${dispute.status}</p>
      ${dispute.timeline ? '<p>Timeline: ' + JSON.stringify(dispute.timeline).substring(0, 100) + '...</p>' : ''}
    </div>`;

    document.getElementById('dispute-modal-body').innerHTML = body;
    openModal('modal-dispute');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Disputes = { loadDisputes, openDisputeModal };
