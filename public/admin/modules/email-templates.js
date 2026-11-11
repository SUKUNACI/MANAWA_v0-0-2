// Email Templates Module - CRUD templates notification
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadEmailTemplates() {
  try {
    const res = await apiCall('/admin/email-templates');
    const { templates = [] } = res;

    let html = templates.length === 0 ? '' : templates.map(t => {
      return `<tr onclick="window.EmailTemplates.openTemplateDetail('${t.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(t.name)}</strong></td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(t.subject || '—')}</td>
        <td style="padding:10px 12px;font-size:11px;text-align:center;">${t.usageCount || 0}x</td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(t.updatedAt || t.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('email-templates-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openTemplateDetail(templateId) {
  try {
    const res = await apiCall('/admin/email-templates/' + templateId);
    if (!res) return;

    const body = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Nom</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(res.name)}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Sujet</div>
      <div style="font-size:12px;">${escHtml(res.subject || '—')}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Contenu</div>
      <div style="font-size:11px;line-height:1.4;max-height:200px;overflow-y:auto;white-space:pre-wrap;">${escHtml(res.body || '')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <button onclick="window.EmailTemplates.editTemplate('${res.id}')" style="padding:10px;background:#3B82F6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✏️ Éditer</button>
      <button onclick="window.EmailTemplates.deleteTemplate('${res.id}')" style="padding:10px;background:#EF4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🗑️ Supprimer</button>
    </div>`;

    document.getElementById('email-templates-detail-modal-body').innerHTML = body;
    openModal('modal-email-template-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function deleteTemplate(templateId) {
  if (!confirm('Supprimer ce template?')) return;
  try {
    await apiCall('/admin/email-templates/' + templateId, {
      method: 'DELETE',
    });
    showToast('✅ Template supprimé');
    closeModal('modal-email-template-detail');
    await loadEmailTemplates();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function editTemplate(templateId) {
  showToast('✏️ Édition disponible dans le formulaire avancé');
}

export const EmailTemplates = {
  loadEmailTemplates,
  openTemplateDetail,
  deleteTemplate,
  editTemplate,
};
