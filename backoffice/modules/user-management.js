// User Management Module - Gestion utilisateurs admins avec rôles
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate } from './ui.js';

export async function loadAdminUsers(page = 1) {
  try {
    const res = await apiCall('/admin/users/admins?page=' + page);
    const { users = [], total = 0, pages = 0 } = res;

    let html = users.length === 0 ? '' : users.map(u => {
      const roleColor = u.role === 'superadmin' ? '#8B5CF6' : u.role === 'admin' ? '#3B82F6' : '#10B981';
      const roleLabel = u.role === 'superadmin' ? '👑 Super Admin' : u.role === 'admin' ? '🔐 Admin' : '👤 Support';

      return `<tr onclick="window.UserManagement.openUserDetail('${u.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(u.email)}</strong></td>
        <td style="padding:10px 12px;"><span style="display:inline-block;background:${roleColor};color:#fff;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:600;">${roleLabel}</span></td>
        <td style="padding:10px 12px;font-size:11px;text-align:center;"><strong>${u.activityCount || 0}</strong> actions</td>
        <td style="padding:10px 12px;font-size:10px;color:${u.active ? '#22C55E' : '#EF4444'};">${u.active ? '✅ Actif' : '❌ Inactif'}</td>
      </tr>`;
    }).join('');

    document.getElementById('admin-users-tbody').innerHTML = html;
    document.getElementById('admin-users-total').textContent = total;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openUserDetail(userId) {
  setState('_currentUserId', userId);
  try {
    const res = await apiCall('/admin/users/' + userId);
    if (!res) { showToast('Utilisateur introuvable', true); return; }

    const roleColor = res.role === 'superadmin' ? '#8B5CF6' : res.role === 'admin' ? '#3B82F6' : '#10B981';
    const roleLabel = res.role === 'superadmin' ? '👑 Super Admin' : res.role === 'admin' ? '🔐 Admin' : '👤 Support';

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Email</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.email)}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Rôle</div>
        <div style="display:inline-block;background:${roleColor};color:#fff;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:600;">${roleLabel}</div>
      </div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Dernière activité</div>
      <div style="font-size:12px;">${formatDate(res.lastActivityAt || res.createdAt)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <button onclick="window.UserManagement.toggleUserStatus('${res.id}')" style="padding:10px;background:${res.active ? '#EF4444' : '#22C55E'};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">${res.active ? '❌ Désactiver' : '✅ Activer'}</button>
      <button onclick="window.UserManagement.resetUserPassword('${res.id}')" style="padding:10px;background:#F59E0B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">🔐 Réinitialiser MDP</button>
    </div>`;

    document.getElementById('user-management-modal-body').innerHTML = body;
    openModal('modal-user-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function toggleUserStatus(userId) {
  try {
    await apiCall('/admin/users/' + userId + '/toggle-status', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Statut utilisateur mis à jour');
    closeModal('modal-user-detail');
    await loadAdminUsers(1);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function resetUserPassword(userId) {
  if (!confirm('Réinitialiser le mot de passe?')) return;
  try {
    const res = await apiCall('/admin/users/' + userId + '/reset-password', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('✅ Email de réinitialisation envoyé');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const UserManagement = {
  loadAdminUsers,
  openUserDetail,
  toggleUserStatus,
  resetUserPassword,
};
