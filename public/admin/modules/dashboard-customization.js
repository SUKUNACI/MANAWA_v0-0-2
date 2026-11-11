// Dashboard Customization Module - Widgets per role, theme settings
import { apiCall } from './api.js';
import { showToast, openModal, escHtml } from './ui.js';

export async function loadCustomizationSettings() {
  try {
    const res = await apiCall('/admin/dashboard/customization');
    const { theme = 'dark', widgets = [] } = res;

    const html = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Thème</div>
      <div style="font-size:12px;font-weight:600;">🎨 ${escHtml(theme === 'dark' ? 'Sombre (par défaut)' : 'Clair')}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Widgets activés</div>
      <div style="font-size:12px;">${widgets.length} / ${widgets.length + 3}</div>
    </div>`;

    document.getElementById('customization-settings-body').innerHTML = html;
    openModal('modal-customization-settings');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const DashboardCustomization = {
  loadCustomizationSettings,
};
