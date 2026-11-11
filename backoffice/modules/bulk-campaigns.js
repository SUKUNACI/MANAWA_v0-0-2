// Bulk Email Campaigns Module - Scheduler, templates, segmentation
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadCampaigns() {
  try {
    const res = await apiCall('/admin/campaigns');
    const { campaigns = [] } = res;

    let html = campaigns.length === 0 ? '' : campaigns.map(c => {
      const statusColor = c.status === 'sent' ? '#22C55E' : c.status === 'scheduled' ? '#3B82F6' : '#F59E0B';
      const statusLabel = c.status === 'sent' ? '✅ Envoyé' : c.status === 'scheduled' ? '📅 Planifié' : '⏳ Brouillon';

      return `<tr onclick="window.BulkCampaigns.openCampaignDetail('${c.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(c.name)}</strong></td>
        <td style="padding:10px 12px;text-align:center;"><strong>${c.recipientCount || 0}</strong></td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${statusColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${statusLabel}</span></td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(c.scheduledAt || c.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('campaigns-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openCampaignDetail(campaignId) {
  try {
    const res = await apiCall('/admin/campaigns/' + campaignId);
    if (!res) return;

    const statusColor = res.status === 'sent' ? '#22C55E' : res.status === 'scheduled' ? '#3B82F6' : '#F59E0B';
    const statusLabel = res.status === 'sent' ? '✅ Envoyé' : res.status === 'scheduled' ? '📅 Planifié' : '⏳ Brouillon';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Nom</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.name)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Statut</div>
        <div style="display:inline-block;background:${statusColor};color:#fff;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:600;">${statusLabel}</div>
      </div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Destinataires</div>
      <div style="font-size:14px;font-weight:700;">${res.recipientCount || 0}</div>
    </div>
    ${res.status === 'draft' ? `<button onclick="window.BulkCampaigns.sendCampaign('${res.id}')" style="padding:10px;background:#22C55E;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;width:100%;">📧 Envoyer</button>` : ''}`;

    document.getElementById('campaigns-detail-modal-body').innerHTML = body;
    openModal('modal-campaigns-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function sendCampaign(campaignId) {
  if (!confirm('Envoyer cette campagne?')) return;
  try {
    await apiCall('/admin/campaigns/' + campaignId + '/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Campagne envoyée');
    closeModal('modal-campaigns-detail');
    await loadCampaigns();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const BulkCampaigns = {
  loadCampaigns,
  openCampaignDetail,
  sendCampaign,
};
