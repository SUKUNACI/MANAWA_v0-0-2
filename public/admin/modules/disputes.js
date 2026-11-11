// Disputes Module - Litiges avec timeline et notifications
import { apiCall } from './api.js';
import { setState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadDisputes(page = 1) {
  try {
    const status = document.getElementById('disputes-status')?.value || '';
    let url = '/admin/disputes?page=' + page + '&limit=50';
    if (status) url += '&status=' + status;

    const res = await apiCall(url);
    const disputes = res.disputes || [];
    const total = res.total || 0;
    const totalPages = res.totalPages || 1;

    let html = disputes.map(d => {
      const statusBadge = {
        PENDING: '⏳ En attente',
        UNDER_REVIEW: '🔍 En examen',
        RESOLVED_REFUND: '✅ Remboursé',
        RESOLVED_PARTIAL: '⚠️ Partiel',
        RESOLVED_REJECTED: '❌ Rejeté',
      }[d.status] || d.status;

      return `<tr onclick="window.Disputes.openDisputeModal('${d.id}')" style="cursor:pointer;">
        <td>${escHtml(d.client.firstName + ' ' + d.client.lastName)}</td>
        <td>${escHtml(d.professional.firstName + ' ' + d.professional.lastName)}</td>
        <td>${d.amount.toLocaleString('fr-FR')} XOF</td>
        <td>${escHtml(d.reason)}</td>
        <td>${statusBadge}</td>
        <td>${formatDate(d.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('disputes-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
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
