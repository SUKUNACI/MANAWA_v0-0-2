// Two-Factor Auth Settings Module - Force 2FA, manage exceptions
import { apiCall } from './api.js';
import { showToast, openModal, escHtml } from './ui.js';

export async function load2FASettings() {
  try {
    const res = await apiCall('/admin/security/2fa');
    const { config = {} } = res;

    const html = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Statut</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:12px;height:12px;background:${config.enforced ? '#22C55E' : '#F59E0B'};border-radius:2px;"></div>
        <div style="font-size:12px;font-weight:600;">${config.enforced ? '🔒 Obligatoire' : '📋 Recommandé'}</div>
      </div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Utilisateurs avec 2FA</div>
      <div style="font-size:14px;font-weight:700;">${config.enabledCount || 0} / ${config.totalUsers || 0}</div>
    </div>`;

    document.getElementById('2fa-settings-body').innerHTML = html;
    openModal('modal-2fa-settings');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const TwoFactorAuth = {
  load2FASettings,
};
