// Disputes Export Module - Exports & archivage disputes
import { apiCall } from './api.js';
import { showToast, formatDate } from './ui.js';
import { getState } from './state.js';

export async function exportDisputesData() {
  const dateFrom = document.getElementById('disputes-export-from')?.value || '';
  const dateTo = document.getElementById('disputes-export-to')?.value || '';
  const status = document.getElementById('disputes-export-status')?.value || '';

  try {
    let url = '/admin/disputes/export?format=csv';
    if (dateFrom) url += '&dateFrom=' + dateFrom;
    if (dateTo) url += '&dateTo=' + dateTo;
    if (status) url += '&status=' + status;

    // ✅ CSRF token from httpOnly cookie only (not localStorage)
    const csrfToken = getState('csrfToken');
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `disputes-${dateFrom}-to-${dateTo}.csv`;
    link.click();

    showToast('✅ Export disputes téléchargé');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const DisputesExport = {
  exportDisputesData,
};
