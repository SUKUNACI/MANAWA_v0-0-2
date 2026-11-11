// Audit Advanced Module - Logs avancés avec filtrage temporal & recherche
import { apiCall, loadModuleTable } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

const ACTION_COLORS = {
  'create': '#22C55E',
  'update': '#3B82F6',
  'delete': '#EF4444',
  'export': '#F59E0B',
};

export async function loadAuditLogs(page = 1, filters = {}) {
  const result = await loadModuleTable({
    endpoint: '/admin/audit/logs?page={page}&limit={limit}',
    selector: {
      tbody: 'audit-logs-tbody',
      empty: 'audit-logs-empty',
      pagination: 'audit-logs-pagination',
    },
    columns: [
      {
        key: 'user',
        label: 'Utilisateur',
        render: (val) => `<strong>${escHtml(val?.email || 'système')}</strong>`,
      },
      {
        key: 'action',
        label: 'Action',
        render: (val) => {
          const color = ACTION_COLORS[val] || '#666';
          return `<span style="display:inline-block;background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;text-transform:uppercase;">${val}</span>`;
        },
      },
      { key: 'entity', label: 'Entité', render: (val) => escHtml(val || '—') },
      { key: 'entityId', label: 'ID', render: (val) => escHtml(val || '—') },
      { key: 'createdAt', label: 'Date', render: (val) => formatDate(val) },
    ],
    onRowClick: (row) => window.AuditAdvanced.openLogDetail(row.id),
    filters: [
      { key: 'dateFrom', input: 'audit-date-from' },
      { key: 'dateTo', input: 'audit-date-to' },
      { key: 'action', input: 'audit-action' },
      { key: 'userId', input: 'audit-user' },
    ],
  }, page);

  // Update total display
  if (document.getElementById('audit-logs-total')) {
    document.getElementById('audit-logs-total').textContent = result.total;
  }

  return result;
}

export async function openLogDetail(logId) {
  try {
    const res = await apiCall('/admin/audit/logs/' + logId);
    if (!res) { showToast('Log introuvable', true); return; }

    const actionColor = {
      'create': '#22C55E',
      'update': '#3B82F6',
      'delete': '#EF4444',
      'export': '#F59E0B',
    }[res.action] || '#666';

    const changesSummary = res.changes && Object.keys(res.changes).length > 0
      ? Object.entries(res.changes).map(([k, v]) => `<div style="font-size:11px;margin:4px 0;"><strong>${k}:</strong> ${escHtml(JSON.stringify(v))}</div>`).join('')
      : '<div style="font-size:11px;color:var(--muted);">—</div>';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Utilisateur</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.user?.email || 'système')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Action</div>
        <div style="display:inline-block;background:${actionColor};color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;">${res.action}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Entité</div>
        <div style="font-size:12px;">${escHtml(res.entity || '—')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">ID</div>
        <div style="font-size:12px;font-family:monospace;">${escHtml(res.entityId || '—')}</div>
      </div>
    </div>

    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Changements</div>
      ${changesSummary}
    </div>

    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Date</div>
      <div style="font-size:12px;">${formatDate(res.createdAt)}</div>
    </div>`;

    document.getElementById('audit-advanced-modal-body').innerHTML = body;
    openModal('modal-audit-advanced');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const AuditAdvanced = {
  loadAuditLogs,
  openLogDetail,
};
