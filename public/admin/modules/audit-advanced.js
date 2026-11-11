// Audit Advanced Module - Logs avancés avec filtrage temporal & recherche
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

export async function loadAuditLogs(page = 1, filters = {}) {
  try {
    const dateFrom = document.getElementById('audit-date-from')?.value || '';
    const dateTo = document.getElementById('audit-date-to')?.value || '';
    const action = document.getElementById('audit-action')?.value || '';
    const userId = document.getElementById('audit-user')?.value || '';

    let url = '/admin/audit/logs?page=' + page;
    if (dateFrom) url += '&dateFrom=' + dateFrom;
    if (dateTo) url += '&dateTo=' + dateTo;
    if (action) url += '&action=' + action;
    if (userId) url += '&userId=' + userId;

    const res = await apiCall(url);
    const { logs = [], total = 0, pages = 0 } = res;

    let html = logs.length === 0 ? '' : logs.map(log => {
      const actionColor = {
        'create': '#22C55E',
        'update': '#3B82F6',
        'delete': '#EF4444',
        'export': '#F59E0B',
      }[log.action] || '#666';

      return `<tr onclick="window.AuditAdvanced.openLogDetail('${log.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:11px;"><strong>${escHtml(log.user?.email || 'système')}</strong></td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${actionColor};color:#fff;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;text-transform:uppercase;">${log.action}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(log.entity || '—')}</td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(log.entityId || '—')}</td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(log.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('audit-logs-tbody').innerHTML = html;
    document.getElementById('audit-logs-empty').style.display = logs.length === 0 ? 'block' : 'none';
    document.getElementById('audit-logs-total').textContent = total;

    // Pagination
    let pageHtml = '';
    for (let i = 1; i <= pages; i++) {
      pageHtml += `<button onclick="window.AuditAdvanced.loadAuditLogs(${i})" style="margin:0 2px;padding:6px 12px;background:${page === i ? '#3B82F6' : 'var(--dark4)'};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">${i}</button>`;
    }
    document.getElementById('audit-logs-pagination').innerHTML = pageHtml;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Audit logs loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
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
