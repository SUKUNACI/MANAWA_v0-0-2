// Export Logs Module - Structured export of all audit/activity logs
import { apiCall } from './api.js';
import { showToast } from './ui.js';
import { getState } from './state.js';

export async function exportAuditLogs() {
  const dateFrom = document.getElementById('export-logs-from')?.value || '';
  const dateTo = document.getElementById('export-logs-to')?.value || '';
  const format = document.getElementById('export-logs-format')?.value || 'csv';

  if (!dateFrom || !dateTo) {
    showToast('Sélectionnez une période', true);
    return;
  }

  try {
    const csrfToken = getState('csrfToken');
    const res = await fetch(`/admin/export/logs?format=${format}&dateFrom=${dateFrom}&dateTo=${dateTo}`, {
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `audit-logs-${dateFrom}-to-${dateTo}.${format === 'json' ? 'json' : 'csv'}`;
    link.click();

    showToast('✅ Logs exportés');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const ExportLogs = {
  exportAuditLogs,
};
