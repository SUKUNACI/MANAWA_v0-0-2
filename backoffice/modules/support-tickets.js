// Support Tickets Module - Workflow tickets support avec réponses
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

export async function loadSupportTickets(page = 1, status = '') {
  try {
    let url = '/admin/support/tickets?page=' + page;
    if (status) url += '&status=' + status;

    const res = await apiCall(url);
    const { tickets = [], total = 0, pages = 0 } = res;

    let html = tickets.length === 0 ? '' : tickets.map(t => {
      const priorityColor = t.priority === 'high' ? '#EF4444' : t.priority === 'medium' ? '#F59E0B' : '#3B82F6';
      const statusColor = t.status === 'resolved' ? '#22C55E' : t.status === 'in-progress' ? '#3B82F6' : '#F59E0B';
      const statusLabel = t.status === 'resolved' ? '✅ Résolu' : t.status === 'in-progress' ? '🔵 En cours' : '⏳ Ouvert';

      return `<tr onclick="window.SupportTickets.openTicketDetail('${t.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>#${t.ticketNumber}</strong></td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(t.subject || '')}</strong></td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(t.reportedBy?.firstName || '')} ${escHtml(t.reportedBy?.lastName || '')}</td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${priorityColor};color:#fff;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;">${t.priority}</span></td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${statusColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${statusLabel}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(t.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('support-tickets-tbody').innerHTML = html;
    document.getElementById('support-tickets-empty').style.display = tickets.length === 0 ? 'block' : 'none';
    document.getElementById('support-tickets-total').textContent = total;

    // Pagination
    let pageHtml = '';
    for (let i = 1; i <= pages; i++) {
      pageHtml += `<button onclick="window.SupportTickets.loadSupportTickets(${i}, '${status}')" style="margin:0 2px;padding:6px 12px;background:${page === i ? '#3B82F6' : 'var(--dark4)'};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">${i}</button>`;
    }
    document.getElementById('support-tickets-pagination').innerHTML = pageHtml;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Support tickets loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openTicketDetail(ticketId) {
  setState('_currentTicketId', ticketId);
  try {
    const res = await apiCall('/admin/support/tickets/' + ticketId);
    if (!res) { showToast('Ticket introuvable', true); return; }

    const statusColor = res.status === 'resolved' ? '#22C55E' : res.status === 'in-progress' ? '#3B82F6' : '#F59E0B';
    const priorityColor = res.priority === 'high' ? '#EF4444' : res.priority === 'medium' ? '#F59E0B' : '#3B82F6';
    const statusLabel = res.status === 'resolved' ? '✅ Résolu' : res.status === 'in-progress' ? '🔵 En cours' : '⏳ Ouvert';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Ticket</div>
        <div style="font-size:13px;font-weight:600;">#${res.ticketNumber}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Priorité</div>
        <div style="display:inline-block;background:${priorityColor};color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;">${res.priority}</div>
      </div>
    </div>

    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Sujet</div>
      <div style="font-size:13px;font-weight:600;">${escHtml(res.subject || '')}</div>
    </div>

    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Description</div>
      <div style="font-size:12px;line-height:1.5;color:var(--light);">${escHtml(res.description || '')}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Statut</div>
        <div style="display:inline-block;background:${statusColor};color:#fff;padding:6px 12px;border-radius:4px;font-size:11px;font-weight:600;">${statusLabel}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Assigné à</div>
        <div style="font-size:12px;">${escHtml(res.assignedTo?.firstName || 'Non assigné')}</div>
      </div>
    </div>

    ${res.status !== 'resolved' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
      ${res.status === 'open' ? `<button onclick="window.SupportTickets.updateTicketStatus('${res.id}', 'in-progress')" style="padding:10px;background:#3B82F6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🔵 Démarrer</button>` : ''}
      <button onclick="window.SupportTickets.updateTicketStatus('${res.id}', 'resolved')" style="padding:10px;background:#22C55E;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✅ Résoudre</button>
    </div>` : ''}`;

    document.getElementById('support-tickets-modal-body').innerHTML = body;
    openModal('modal-support-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function updateTicketStatus(ticketId, status) {
  try {
    await apiCall('/admin/support/tickets/' + ticketId + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('✅ Ticket mis à jour');
    closeModal('modal-support-detail');
    await loadSupportTickets(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const SupportTickets = {
  loadSupportTickets,
  openTicketDetail,
  updateTicketStatus,
};
