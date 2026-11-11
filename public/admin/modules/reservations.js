// Reservations Module
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, debounce, formatDate } from './ui.js';

export const debounceReservations = debounce(() => loadReservations(1), 300);

export async function loadReservations(page = 1) {
  try {
    const search = document.getElementById('reservations-search')?.value || '';
    const status = document.getElementById('reservations-status')?.value || '';
    const proFilter = document.getElementById('reservations-pro-filter')?.value || '';
    const dateFrom = document.getElementById('reservations-date-from')?.value || '';
    const dateTo = document.getElementById('reservations-date-to')?.value || '';

    let url = '/admin/bookings?page=' + page + '&limit=50';
    if (status) url += '&status=' + status;
    if (search) url += '&search=' + encodeURIComponent(search);
    if (proFilter) url += '&professionalId=' + proFilter;
    if (dateFrom) url += '&dateFrom=' + dateFrom;
    if (dateTo) url += '&dateTo=' + dateTo;

    const res = await apiCall(url);
    const { bookings = [], total = 0, page: currentPage = 1, totalPages = 1 } = res;

    const prosCache = getState('_reservationsProsCache') || new Map();
    bookings.forEach(b => {
      if (b.professional && b.professional.id) {
        const name = (b.professional.firstName || '') + ' ' + (b.professional.lastName || '') || b.professional.companyName || 'Unknown';
        prosCache.set(b.professional.id, name);
      }
    });
    setState('_reservationsProsCache', prosCache);

    const proSelect = document.getElementById('reservations-pro-filter');
    if (proSelect && proSelect.options.length === 1) {
      // Build a Set of existing option values for O(1) lookup instead of O(n) search
      const existingIds = new Set(Array.from(proSelect.options).map(o => o.value));
      prosCache.forEach((name, id) => {
        if (!existingIds.has(id)) {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = name;
          proSelect.appendChild(option);
        }
      });
    }

    let html = bookings.length === 0 ? '' : bookings.map(b => {
      const dateObj = new Date(b.date);
      const dateStr = dateObj.toLocaleDateString('fr-FR');
      const statusBadge = {
        PENDING: '<span class="badge badge-yellow">⏳ En attente</span>',
        CONFIRMED: '<span class="badge badge-green">✅ Confirmée</span>',
        COMPLETED: '<span class="badge badge-blue">✔️ Complétée</span>',
        CANCELLED: '<span class="badge badge-red">❌ Annulée</span>',
      }[b.status] || b.status;
      const clientName = (b.client.firstName || '') + ' ' + (b.client.lastName || '');
      const proName = (b.professional.firstName || '') + ' ' + (b.professional.lastName || '') || b.professional.companyName || '—';
      const projectTitle = b.project ? b.project.title : '—';

      return `<tr onclick="window.Reservations.openReservationModal('${b.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;white-space:nowrap;">${dateStr}</td>
        <td style="padding:10px 12px;font-size:12px;white-space:nowrap;">${b.startTime} - ${b.endTime}</td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(clientName)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(b.client.email)}</span></td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(proName)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(b.professional.email)}</span></td>
        <td style="padding:10px 12px;font-size:12px;">${statusBadge}</td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(projectTitle)}</strong></td>
        <td style="padding:10px 12px;text-align:center;" onclick="event.stopPropagation();">
          ${b.status !== 'CANCELLED' && b.status !== 'COMPLETED' ? `<button class="btn btn-view" onclick="window.Reservations.cancelReservationModal('${b.id}')" style="padding:4px 8px;font-size:10px;">❌ Annuler</button>` : '—'}
        </td>
      </tr>`;
    }).join('');

    document.getElementById('reservations-tbody').innerHTML = html;
    document.getElementById('reservations-empty').style.display = bookings.length === 0 ? 'block' : 'none';

    let paginationHtml = '';
    if (totalPages > 1) {
      if (currentPage > 1) paginationHtml += `<button class="btn btn-secondary" onclick="window.Reservations.loadReservations(1)">⏮️ Première</button><button class="btn btn-secondary" onclick="window.Reservations.loadReservations(${currentPage - 1})">◀️ Précédente</button>`;
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;
      if (currentPage < totalPages) paginationHtml += `<button class="btn btn-secondary" onclick="window.Reservations.loadReservations(${currentPage + 1})">Suivante ▶️</button><button class="btn btn-secondary" onclick="window.Reservations.loadReservations(${totalPages})">Dernière ⏭️</button>`;
    }
    document.getElementById('reservations-pagination').innerHTML = paginationHtml;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openReservationModal(bookingId) {
  setState('_currentReservationId', bookingId);
  try {
    const booking = await apiCall('/admin/bookings/' + bookingId);
    if (!booking) { showToast('Réservation introuvable', true); return; }

    const dateObj = new Date(booking.date);
    const dateStr = dateObj.toLocaleDateString('fr-FR');
    const clientName = (booking.client.firstName || '') + ' ' + (booking.client.lastName || '');
    const proName = (booking.professional.firstName || '') + ' ' + (booking.professional.lastName || '') || booking.professional.companyName || '—';
    const projectTitle = booking.project ? booking.project.title : '(sans projet)';

    const statusLabel = {
      PENDING: '⏳ En attente',
      CONFIRMED: '✅ Confirmée',
      COMPLETED: '✔️ Complétée',
      CANCELLED: '❌ Annulée'
    };

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Date</div>
        <div style="font-size:14px;font-weight:600;">${dateStr}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Horaire</div>
        <div style="font-size:14px;font-weight:600;">${booking.startTime} - ${booking.endTime}</div>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Client</div>
      <div style="font-size:14px;font-weight:600;">${escHtml(clientName)}</div>
      <div style="font-size:12px;color:var(--muted);">${escHtml(booking.client.email)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Professionnel</div>
      <div style="font-size:14px;font-weight:600;">${escHtml(proName)}</div>
      <div style="font-size:12px;color:var(--muted);">${escHtml(booking.professional.email)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Projet</div>
      <div style="font-size:14px;font-weight:600;">${escHtml(projectTitle)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Statut</div>
      <div style="font-size:14px;font-weight:600;">${statusLabel[booking.status] || booking.status}</div>
    </div>`;

    document.getElementById('res-modal-body').innerHTML = body;

    let actionBtns = '';
    if (booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED') {
      actionBtns = '<button class="btn btn-view" onclick="window.Reservations.openReservationDetail()" style="flex:1;">👁️ Détails</button><button class="btn btn-reject" onclick="window.Reservations.toggleReservationCancelForm()" style="flex:1;">❌ Annuler</button>';
    }
    document.getElementById('res-action-buttons').innerHTML = actionBtns;

    document.getElementById('res-notify-section').style.display = (booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED') ? 'block' : 'none';
    document.getElementById('res-cancel-reason').value = '';
    document.getElementById('res-notify-checkbox').checked = true;

    if (booking.auditLog && booking.auditLog.length > 0) {
      let log = '';
      booking.auditLog.forEach(entry => {
        log += `<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,.05);background:rgba(255,255,255,.02);border-radius:6px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:14px;">📝</span>
            <strong style="font-size:11px;color:var(--white);">${escHtml(entry.action)}</strong>
            <span style="font-size:9px;color:var(--muted);margin-left:auto;">${formatDate(entry.createdAt)}</span>
          </div>
          <div style="font-size:10px;color:var(--muted);">par ${escHtml(entry.admin || 'Système')}</div>
          ${entry.details ? '<div style="margin-top:4px;font-size:10px;color:var(--light);background:rgba(255,255,255,.03);padding:4px;border-radius:4px;">' + escHtml(entry.details) + '</div>' : ''}
        </div>`;
      });
      document.getElementById('res-audit-log').innerHTML = log;
      document.getElementById('res-audit-section').style.display = 'block';
    } else {
      document.getElementById('res-audit-section').style.display = 'none';
    }

    openModal('modal-reservation');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function toggleReservationCancelForm() {
  const form = document.getElementById('res-notify-section');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

export function openReservationDetail() {
  showToast('Détails complets affichés');
}

export async function confirmReservation(bookingId) {
  if (!confirm('Confirmer cette réservation?')) return;

  try {
    await apiCall('/admin/bookings/' + bookingId + '/confirm', {
      method: 'POST',
      body: JSON.stringify({})
    });
    showToast('✅ Réservation confirmée');
    closeModal('modal-reservation');
    await loadReservations(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function submitReservationCancel() {
  const bookingId = getState('_currentReservationId');
  if (!bookingId) return;
  const reason = document.getElementById('res-cancel-reason').value;
  const notify = document.getElementById('res-notify-checkbox').checked;

  if (!reason.trim()) {
    showToast('Veuillez entrer une raison d\'annulation', true);
    return;
  }

  try {
    await apiCall('/admin/bookings/' + bookingId + '/cancel', {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null, notifyClient: notify })
    });
    closeModal('modal-reservation');
    showToast('✅ Réservation annulée' + (notify ? ' (notification envoyée)' : ''));
    await loadReservations(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function cancelReservationModal(bookingId) {
  setState('_currentReservationId', bookingId);
  document.getElementById('res-notify-section').style.display = 'block';
  document.getElementById('res-cancel-reason').focus();
}

export async function bulkCancelReservations(bookingIds) {
  if (!bookingIds || bookingIds.length === 0) {
    showToast('Sélectionnez au moins une réservation', true);
    return;
  }

  const reason = document.getElementById('bulk-cancel-reason')?.value?.trim() || '';
  if (!reason) {
    showToast('Veuillez entrer une raison d\'annulation', true);
    return;
  }

  const notify = document.getElementById('bulk-notify-checkbox')?.checked || false;

  if (!confirm('Annuler ' + bookingIds.length + ' réservation(s)?')) return;

  try {
    await apiCall('/admin/bookings/bulk/cancel', {
      method: 'POST',
      body: JSON.stringify({
        bookingIds: Array.from(bookingIds),
        reason: reason,
        notifyClients: notify
      })
    });
    showToast('✅ ' + bookingIds.length + ' réservation(s) annulée(s)');
    closeModal('modal-bulk-cancel');
    await loadReservations(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function exportReservations() {
  try {
    const url = '/admin/bookings/export?format=csv';
    window.location.href = url;
    showToast('📥 Export en cours...');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Reservations = {
  loadReservations,
  openReservationModal,
  toggleReservationCancelForm,
  openReservationDetail,
  submitReservationCancel,
  cancelReservationModal,
  confirmReservation,
  bulkCancel: bulkCancelReservations,
  exportReservations,
  debounceReservations,
  _currentReservationId: null,
  _selectedIds: new Set(),
  cancelReservation: async (bookingId) => {
    const reason = document.getElementById('reservations-cancel-reason')?.value?.trim() || '';
    const notify = document.getElementById('reservations-notify-checkbox')?.checked || false;

    if (!reason) {
      showToast('Veuillez entrer une raison d\'annulation', true);
      return;
    }

    try {
      await apiCall('/admin/bookings/' + bookingId + '/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason, notifyClient: notify })
      });
      showToast('✅ Réservation annulée' + (notify ? ' (notification envoyée)' : ''));
      closeModal('modal-reservations-detail');
      await loadReservations(1);
    } catch (err) {
      showToast('Erreur : ' + err.message, true);
    }
  }
};
