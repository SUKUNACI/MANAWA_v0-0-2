// Communication Module - Messagerie & Broadcast
import { apiCall } from './api.js';
import { showToast, openModal, closeModal } from './ui.js';

export async function openBroadcastDialog() {
  openModal('modal-broadcast');
}

export async function sendBroadcast() {
  const target = document.getElementById('broadcast-target').value;
  const title = document.getElementById('broadcast-title').value;
  const message = document.getElementById('broadcast-message').value;

  if (!target || !title || !message) {
    showToast('Tous les champs sont requis', true);
    return;
  }

  if (!confirm(`Envoyer à ${target === 'all' ? 'TOUS' : target === 'professionals' ? 'tous les artisans' : 'tous les clients'}?\n\nTitre: ${title}`)) return;

  try {
    const res = await apiCall('/admin/communication/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        targetAudience: target,
        title,
        message,
        channels: ['push', 'email'],
      }),
    });

    showToast(`✅ Message envoyé à ${res.sentCount} destinataire(s)`);
    closeModal('modal-broadcast');

    // Reset form
    document.getElementById('broadcast-target').value = '';
    document.getElementById('broadcast-title').value = '';
    document.getElementById('broadcast-message').value = '';
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Communication = {
  openBroadcastDialog,
  sendBroadcast,
};
