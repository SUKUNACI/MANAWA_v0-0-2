// Webhook Manager Module - Création, test, gestion webhooks
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadWebhooks() {
  try {
    const res = await apiCall('/admin/webhooks');
    const { webhooks = [] } = res;

    let html = webhooks.length === 0 ? '' : webhooks.map(w => {
      const statusColor = w.active ? '#22C55E' : '#EF4444';
      const status = w.active ? '✅ Actif' : '❌ Inactif';

      return `<tr onclick="window.WebhookManager.openWebhookDetail('${w.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(w.event)}</strong></td>
        <td style="padding:10px 12px;font-size:11px;font-family:monospace;word-break:break-all;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escHtml(w.url)}</td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${statusColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;">${status}</span></td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(w.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('webhooks-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openWebhookDetail(webhookId) {
  try {
    const res = await apiCall('/admin/webhooks/' + webhookId);
    if (!res) return;

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Event</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.event)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Statut</div>
        <div style="display:inline-block;background:${res.active ? '#22C55E' : '#EF4444'};color:#fff;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:600;">${res.active ? '✅ Actif' : '❌ Inactif'}</div>
      </div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">URL</div>
      <div style="font-size:11px;font-family:monospace;word-break:break-all;">${escHtml(res.url)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <button onclick="window.WebhookManager.testWebhook('${res.id}')" style="padding:10px;background:#3B82F6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🧪 Tester</button>
      <button onclick="window.WebhookManager.deleteWebhook('${res.id}')" style="padding:10px;background:#EF4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🗑️ Supprimer</button>
    </div>`;

    document.getElementById('webhooks-detail-modal-body').innerHTML = body;
    openModal('modal-webhook-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function testWebhook(webhookId) {
  try {
    await apiCall('/admin/webhooks/' + webhookId + '/test', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Webhook testé (vérifiez les logs)');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function deleteWebhook(webhookId) {
  if (!confirm('Supprimer ce webhook?')) return;
  try {
    await apiCall('/admin/webhooks/' + webhookId, {
      method: 'DELETE',
    });
    showToast('✅ Webhook supprimé');
    closeModal('modal-webhook-detail');
    await loadWebhooks();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const WebhookManager = {
  loadWebhooks,
  openWebhookDetail,
  testWebhook,
  deleteWebhook,
};
