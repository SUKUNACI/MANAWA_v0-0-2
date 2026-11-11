// API Keys Module - Génération, révocation, gestion tokens API
import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadAPIKeys() {
  try {
    const res = await apiCall('/admin/api/keys');
    const { keys = [] } = res;

    let html = keys.length === 0 ? '' : keys.map(k => {
      const maskedKey = k.key.substring(0, 10) + '...' + k.key.substring(k.key.length - 5);
      const activeColor = k.active ? '#22C55E' : '#EF4444';
      const status = k.active ? '✅' : '❌';

      return `<tr onclick="window.APIKeys.openKeyDetail('${k.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:11px;font-family:monospace;">${maskedKey}</td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(k.name || 'Sans nom')}</td>
        <td style="padding:10px 12px;font-size:11px;"><strong>${k.usageCount || 0}</strong> appels</td>
        <td style="padding:10px 12px;text-align:center;"><span style="color:${activeColor};font-weight:600;">${status}</span></td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(k.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('api-keys-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openKeyDetail(keyId) {
  try {
    const res = await apiCall('/admin/api/keys/' + keyId);
    if (!res) return;

    const body = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Clé (non affichée)</div>
      <div style="font-size:11px;font-family:monospace;color:var(--muted);">••••••••••••••••••••</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Nom</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(res.name || 'Sans nom')}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Utilisations</div>
      <div style="font-size:14px;font-weight:700;">${res.usageCount || 0}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <button onclick="window.APIKeys.revokeKey('${res.id}')" style="padding:10px;background:#EF4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🔒 Révoquer</button>
      <button onclick="window.APIKeys.rotateKey('${res.id}')" style="padding:10px;background:#F59E0B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🔄 Rotater</button>
    </div>`;

    document.getElementById('api-keys-detail-modal-body').innerHTML = body;
    openModal('modal-api-keys-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function revokeKey(keyId) {
  if (!confirm('Révoquer cette clé API?')) return;
  try {
    await apiCall('/admin/api/keys/' + keyId + '/revoke', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Clé révoquée');
    closeModal('modal-api-keys-detail');
    await loadAPIKeys();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function rotateKey(keyId) {
  if (!confirm('Rotater cette clé? (nouvelle clé générée)')) return;
  try {
    await apiCall('/admin/api/keys/' + keyId + '/rotate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Clé rotatée (nouvelle clé générée)');
    closeModal('modal-api-keys-detail');
    await loadAPIKeys();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const APIKeys = {
  loadAPIKeys,
  openKeyDetail,
  revokeKey,
  rotateKey,
};
