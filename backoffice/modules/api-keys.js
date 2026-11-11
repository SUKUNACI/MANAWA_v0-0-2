// API Keys Module - Génération, révocation, gestion tokens API
import { apiCall, loadModuleTable, debounceModuleTableSearch } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadAPIKeys(page = 1) {
  return loadModuleTable({
    endpoint: '/admin/api/keys?page={page}&limit={limit}',
    selector: {
      tbody: 'api-keys-tbody',
      pagination: 'api-keys-pagination',
    },
    columns: [
      {
        key: 'key',
        label: 'Clé',
        render: (val) => {
          const masked = val.substring(0, 10) + '...' + val.substring(val.length - 5);
          return `<span style="font-family:monospace;">${escHtml(masked)}</span>`;
        },
      },
      { key: 'name', label: 'Nom', render: (val) => escHtml(val || 'Sans nom') },
      {
        key: 'usageCount',
        label: 'Utilisation',
        render: (val) => `<strong>${val || 0}</strong> appels`,
      },
      {
        key: 'active',
        label: 'Statut',
        render: (val) => {
          const color = val ? '#22C55E' : '#EF4444';
          const status = val ? '✅' : '❌';
          return `<span style="color:${color};font-weight:600;">${status}</span>`;
        },
      },
      { key: 'createdAt', label: 'Créée', render: (val) => formatDate(val) },
    ],
    onRowClick: (row) => window.APIKeys.openKeyDetail(row.id),
  }, page);
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
