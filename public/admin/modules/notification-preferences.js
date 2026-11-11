// Notification Preferences Module - Per-user notification routing
import { apiCall } from './api.js';
import { showToast, openModal, escHtml } from './ui.js';

export async function loadNotificationPreferences() {
  try {
    const res = await apiCall('/admin/notifications/preferences');
    const { preferences = {} } = res;

    const channels = ['email', 'push', 'sms'];
    const types = ['alerts', 'updates', 'reports'];

    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += '<tr><td style="padding:8px;"></td>';
    channels.forEach(ch => {
      html += `<td style="padding:8px;text-align:center;font-weight:600;font-size:11px;">${ch}</td>`;
    });
    html += '</tr>';

    types.forEach(type => {
      html += `<tr><td style="padding:8px;font-size:11px;font-weight:600;">${type}</td>`;
      channels.forEach(ch => {
        const checked = preferences[type]?.[ch] ? '✅' : '❌';
        html += `<td style="padding:8px;text-align:center;">${checked}</td>`;
      });
      html += '</tr>';
    });
    html += '</table>';

    document.getElementById('notification-preferences-body').innerHTML = html;
    openModal('modal-notification-preferences');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const NotificationPreferences = {
  loadNotificationPreferences,
};
