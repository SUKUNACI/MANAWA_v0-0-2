// Settings Module - Paramètres système
import { apiCall } from './api.js';
import { showToast, openModal, closeModal } from './ui.js';

export async function loadSettings() {
  try {
    const res = await apiCall('/admin/settings');
    if (!res || !res.settings) return;

    const settings = res.settings;

    // Populate form fields
    document.getElementById('settings-company-name').value = settings.companyName || '';
    document.getElementById('settings-support-email').value = settings.supportEmail || '';
    document.getElementById('settings-max-quote-amount').value = settings.maxQuoteAmount || '';
    document.getElementById('settings-sla-days').value = settings.slaDays || 7;
    document.getElementById('settings-commission-rate').value = settings.commissionRate || 0;

    // ✅ MINOR FIX: Remove console.log from production
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log('✅ Settings loaded');
    }
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function saveSettings() {
  const data = {
    companyName: document.getElementById('settings-company-name').value,
    supportEmail: document.getElementById('settings-support-email').value,
    maxQuoteAmount: parseFloat(document.getElementById('settings-max-quote-amount').value),
    slaDays: parseInt(document.getElementById('settings-sla-days').value),
    commissionRate: parseFloat(document.getElementById('settings-commission-rate').value),
  };

  try {
    await apiCall('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    showToast('✅ Paramètres sauvegardés');
    await loadSettings();
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Settings = {
  loadSettings,
  saveSettings,
};
