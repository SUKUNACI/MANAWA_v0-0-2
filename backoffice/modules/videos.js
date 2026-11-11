// Videos Module - Gestion des appels vidéo
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadVideoCallsHistory() {
  try {
    const res = await apiCall('/admin/video-calls/history');
    const { calls = [], total = 0 } = res;

    let html = calls.length === 0 ? '' : calls.map(c => {
      const duration = c.endedAt ? Math.round((new Date(c.endedAt) - new Date(c.startedAt)) / 60000) : 0;
      const status = c.endedAt ? '✅ Terminé' : c.startedAt ? '🔴 En cours' : '⏳ En attente';

      return `<tr onclick="window.Videos.openCallDetail('${c.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(c.professional?.firstName || '')} ${escHtml(c.professional?.lastName || '')}</strong></td>
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(c.client?.firstName || '')} ${escHtml(c.client?.lastName || '')}</strong></td>
        <td style="padding:10px 12px;text-align:center;">${duration}m</td>
        <td style="padding:10px 12px;text-align:center;"><span style="display:inline-block;background:${c.endedAt ? '#22C55E' : c.startedAt ? '#EF4444' : '#F59E0B'};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;">${status}</span></td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(c.startedAt || c.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('videos-tbody').innerHTML = html;
    document.getElementById('videos-empty').style.display = calls.length === 0 ? 'block' : 'none';
    document.getElementById('videos-total').textContent = total;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Video calls history loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openCallDetail(callId) {
  try {
    const res = await apiCall('/admin/video-calls/' + callId);
    if (!res) { showToast('Appel introuvable', true); return; }

    const duration = res.endedAt ? Math.round((new Date(res.endedAt) - new Date(res.startedAt)) / 60000) : 0;
    const status = res.endedAt ? '✅ Terminé' : res.startedAt ? '🔴 En cours' : '⏳ En attente';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Artisan</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(res.professional?.firstName || '')} ${escHtml(res.professional?.lastName || '')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Client</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(res.client?.firstName || '')} ${escHtml(res.client?.lastName || '')}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Durée</div>
        <div style="font-size:16px;font-weight:700;">${duration}m</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Statut</div>
        <div style="font-size:13px;font-weight:600;">${status}</div>
      </div>
    </div>`;

    document.getElementById('videos-modal-body').innerHTML = body;
    openModal('modal-video-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Videos = {
  loadVideoCallsHistory,
  openCallDetail,
};
