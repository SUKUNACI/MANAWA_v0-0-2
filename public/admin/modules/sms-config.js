// SMS Configuration Module - Twilio setup, test, manage
import { apiCall } from './api.js';
import { showToast, openModal, escHtml } from './ui.js';

export async function loadSMSConfig() {
  try {
    const res = await apiCall('/admin/sms/config');
    const { config = {} } = res;

    const html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Statut</div>
        <div style="color:${config.enabled ? '#22C55E' : '#EF4444'};font-weight:600;">${config.enabled ? '✅ Activé' : '❌ Désactivé'}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Crédit restant</div>
        <div style="font-size:14px;font-weight:700;">${config.balance || 'N/A'}</div>
      </div>
    </div>
    <button onclick="window.SMSConfig.testSMS()" style="padding:10px;background:#3B82F6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;width:100%;">🧪 Envoyer SMS test</button>`;

    document.getElementById('sms-config-body').innerHTML = html;
    openModal('modal-sms-config');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function testSMS() {
  try {
    await apiCall('/admin/sms/test', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ SMS test envoyé');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const SMSConfig = {
  loadSMSConfig,
  testSMS,
};
