// Role Permissions Module - Gestion complète des permissions de rôles
// Affichage, modification, historique et rollback des permissions

import { apiCall } from './api.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

let currentRoleId = null;
let currentRoleName = null;
let allSections = [];
let currentHistoryPage = 1;

// ══════════════════════════════════════════════════════════════
// INITIALIZATION & LOADING
// ══════════════════════════════════════════════════════════════

export async function load() {
  try {
    // Charger les rôles disponibles
    const rolesRes = await apiCall('/admin/roles');
    if (!rolesRes || !rolesRes.roles) throw new Error('Impossible de charger les rôles');

    const roleSelect = document.getElementById('role-select');
    roleSelect.innerHTML = '<option value="">-- Sélectionner un rôle --</option>';

    rolesRes.roles.forEach(role => {
      const opt = document.createElement('option');
      opt.value = role.id;
      opt.textContent = `${role.name} (${role.slug})`;
      roleSelect.appendChild(opt);
    });

    // Charger toutes les sections disponibles
    const sectionsRes = await apiCall('/role-permissions/all-sections');
    if (!sectionsRes || !sectionsRes.sections) throw new Error('Impossible de charger les sections');
    allSections = sectionsRes.sections;

    showToast('✅ Module permissions chargé', false);
  } catch (err) {
    showToast('Erreur chargement: ' + err.message, true);
  }
}

// ══════════════════════════════════════════════════════════════
// ROLE SELECTION & PERMISSIONS DISPLAY
// ══════════════════════════════════════════════════════════════

export async function selectRole(roleId) {
  if (!roleId) {
    document.getElementById('permissions-grid').innerHTML = '';
    document.getElementById('role-info').innerHTML = '';
    currentRoleId = null;
    return;
  }

  try {
    const res = await apiCall(`/role-permissions/${roleId}`);
    if (!res) throw new Error('Rôle non trouvé');

    currentRoleId = roleId;
    currentRoleName = res.roleName;
    currentHistoryPage = 1;

    // Afficher les infos du rôle
    displayRoleInfo(res);

    // Afficher la grille des permissions
    displayPermissionsGrid(res);

    // Charger et afficher l'historique
    await loadPermissionHistory();

    // Reset les tabs
    selectPermissionTab('grid');
  } catch (err) {
    showToast('Erreur: ' + err.message, true);
  }
}

export function displayRoleInfo(roleData) {
  const html = `
    <div style="background:linear-gradient(135deg,rgba(244,114,11,0.1),rgba(255,255,255,0.02));border:1px solid rgba(244,114,11,0.2);border-radius:12px;padding:16px;margin-bottom:20px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px;">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;font-weight:600;letter-spacing:1px;">Rôle</div>
          <div style="font-size:16px;font-weight:700;color:var(--white);">${escHtml(roleData.roleName)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;font-weight:600;letter-spacing:1px;">Slug</div>
          <div style="font-size:12px;font-family:monospace;color:var(--muted);">${escHtml(roleData.slug)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;">
        <span style="font-size:12px;color:var(--muted);">📊 Permissions assignées:</span>
        <strong style="font-size:13px;color:var(--orange);">${roleData.sections ? roleData.sections.length : 0} section${roleData.sections && roleData.sections.length > 1 ? 's' : ''}</strong>
      </div>
    </div>
  `;
  document.getElementById('role-info').innerHTML = html;
}

export function displayPermissionsGrid(roleData) {
  const sections = roleData.sections || [];

  if (sections.length === 0) {
    document.getElementById('permissions-grid').innerHTML = `
      <div style="grid-column:1/-1;padding:40px;text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;border-radius:12px;color:var(--muted);">
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;">📭 Aucune permission assignée</div>
        <div style="font-size:12px;">Ce rôle n'a pas de permissions de section. Utilisez "Modifier les permissions" pour ajouter.</div>
      </div>
    `;
    return;
  }

  const permissionMap = Object.fromEntries(sections.map(s => [s.name, s]));

  let html = '';
  allSections.forEach(section => {
    const perm = permissionMap[section.name] || {};
    const hasPerms = Object.values({
      canCreate: perm.canCreate,
      canRead: perm.canRead,
      canUpdate: perm.canUpdate,
      canDelete: perm.canDelete,
    }).some(v => v === true);

    const actionLabels = { canCreate: 'Créer', canRead: 'Lire', canUpdate: 'Modifier', canDelete: 'Supprimer' };
    const actions = ['canCreate', 'canRead', 'canUpdate', 'canDelete'];

    const actionHtml = actions
      .filter(a => perm[a])
      .map(a => `<span class="badge badge-green" style="margin-bottom:0;">${actionLabels[a]}</span>`)
      .join(' ');

    const statusColor = hasPerms ? 'var(--green)' : 'var(--muted)';
    const statusIcon = hasPerms ? '✅' : '❌';

    html += `
      <div style="background:var(--dark3);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:16px;transition:all .2s;cursor:pointer;" onmouseover="this.style.borderColor='rgba(244,114,11,0.3)';this.style.background='rgba(244,114,11,0.05)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.background='var(--dark3)'" onclick="window.RolePermissions.openSectionModal('${section.name}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;">
          <div style="flex:1;min-width:0;">
            <h4 style="font-size:13px;font-weight:600;color:var(--white);margin:0 0 4px 0;">${escHtml(section.description || section.name)}</h4>
            <p style="font-size:11px;color:var(--muted);margin:0;">${escHtml(section.name)}</p>
          </div>
          <div style="font-size:16px;margin-left:8px;flex-shrink:0;">${statusIcon}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${actionHtml || '<span style="font-size:11px;color:var(--muted);">— Aucune action</span>'}
        </div>
      </div>
    `;
  });

  document.getElementById('permissions-grid').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      ${html}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
// PERMISSION MANAGEMENT - MODAL & EDITING
// ══════════════════════════════════════════════════════════════

export async function openSectionModal(sectionName) {
  if (!currentRoleId) return;

  const section = allSections.find(s => s.name === sectionName);
  if (!section) return;

  const res = await apiCall(`/role-permissions/${currentRoleId}`);
  const sectionPerm = (res.sections || []).find(s => s.name === sectionName) || {
    name: sectionName,
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
  };

  const actionLabels = { canCreate: 'Créer', canRead: 'Lire', canUpdate: 'Modifier', canDelete: 'Supprimer' };
  const actions = ['canCreate', 'canRead', 'canUpdate', 'canDelete'];

  let checkboxHtml = '';
  actions.forEach(action => {
    const checked = sectionPerm[action];
    const label = actionLabels[action];
    const bgColor = checked ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.1)';
    const borderColor = checked ? 'rgba(34,197,94,0.4)' : 'rgba(107,114,128,0.2)';

    checkboxHtml += `
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:${bgColor};border:1px solid ${borderColor};border-radius:8px;cursor:pointer;transition:all .2s;margin-bottom:8px;">
        <input type="checkbox" id="perm-${action}" ${checked ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--green);" />
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--white);">${label}</div>
          <div style="font-size:11px;color:var(--muted);">Autoriser ${label.toLowerCase()}</div>
        </div>
      </label>
    `;
  });

  const modalBody = `
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:1px;">Section</div>
      <h3 style="font-size:16px;font-weight:700;color:var(--white);margin:0 0 4px 0;">${escHtml(section.description || section.name)}</h3>
      <p style="font-size:12px;color:var(--muted);margin:0;font-family:monospace;">${escHtml(section.name)}</p>
    </div>

    <div style="margin-bottom:20px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:12px;font-weight:600;letter-spacing:1px;">Permissions</div>
      ${checkboxHtml}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
      <button onclick="window.RolePermissions.updatePermissions('${sectionName}')" style="padding:11px 16px;background:var(--green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;font-size:13px;transition:all .2s;" onmouseover="this.style.background='#16A34A'" onmouseout="this.style.background='var(--green)'">
        ✅ Appliquer les changements
      </button>
      <button onclick="window.closeModal('modal-section-permissions')" style="padding:11px 16px;background:var(--dark4);color:var(--light);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;font-size:13px;transition:all .2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='var(--dark4)'">
        Annuler
      </button>
    </div>
  `;

  document.getElementById('section-permissions-modal-body').innerHTML = modalBody;
  document.getElementById('section-modal-title').textContent = `Modifier: ${section.description || section.name}`;
  openModal('modal-section-permissions');
}

export async function updatePermissions(sectionName) {
  if (!currentRoleId) return;

  try {
    // Récupérer les actions sélectionnées
    const actions = [];
    const actionNames = ['canCreate', 'canRead', 'canUpdate', 'canDelete'];
    const actionMap = { canCreate: 'create', canRead: 'read', canUpdate: 'update', canDelete: 'delete' };

    actionNames.forEach(action => {
      if (document.getElementById(`perm-${action}`)?.checked) {
        actions.push(actionMap[action]);
      }
    });

    if (actions.length === 0) {
      showToast('⚠️ Au moins une action doit être sélectionnée', true);
      return;
    }

    // Récupérer les permissions actuelles
    const currentRes = await apiCall(`/role-permissions/${currentRoleId}`);
    const currentSection = (currentRes.sections || []).find(s => s.name === sectionName);

    if (currentSection) {
      // Permissions existent - vérifier si changement
      const currentActions = [];
      if (currentSection.canCreate) currentActions.push('create');
      if (currentSection.canRead) currentActions.push('read');
      if (currentSection.canUpdate) currentActions.push('update');
      if (currentSection.canDelete) currentActions.push('delete');

      const hasChanges = JSON.stringify(actions.sort()) !== JSON.stringify(currentActions.sort());

      if (!hasChanges) {
        showToast('ℹ️ Aucun changement détecté', false);
        closeModal('modal-section-permissions');
        return;
      }
    }

    // Envoyer la mise à jour via GRANT
    await apiCall(`/role-permissions/grant`, {
      method: 'POST',
      body: JSON.stringify({
        roleId: currentRoleId,
        section: sectionName,
        actions,
      }),
    });

    showToast(`✅ Permissions mises à jour pour ${sectionName}`, false);
    closeModal('modal-section-permissions');

    // Recharger les permissions et l'historique
    await selectRole(currentRoleId);
  } catch (err) {
    showToast('Erreur: ' + err.message, true);
  }
}

export async function revokeAction(sectionName, actionName) {
  if (!currentRoleId) return;

  if (!confirm(`Révoquer l'action "${actionName}" pour "${sectionName}"?`)) return;

  try {
    await apiCall(`/role-permissions/revoke`, {
      method: 'POST',
      body: JSON.stringify({
        roleId: currentRoleId,
        section: sectionName,
        actions: [actionName],
      }),
    });

    showToast(`✅ Action "${actionName}" révoquée`, false);
    await selectRole(currentRoleId);
  } catch (err) {
    showToast('Erreur: ' + err.message, true);
  }
}

// ══════════════════════════════════════════════════════════════
// HISTORY & AUDIT LOG
// ══════════════════════════════════════════════════════════════

export async function loadPermissionHistory() {
  if (!currentRoleId) return;

  try {
    const res = await apiCall(`/role-permissions/history/${currentRoleId}?page=${currentHistoryPage}&limit=20`);
    displayPermissionHistory(res);
  } catch (err) {
    console.error('Erreur historique:', err);
    document.getElementById('history-container').innerHTML = `<div style="color:var(--red);padding:16px;">Erreur: ${err.message}</div>`;
  }
}

export function displayPermissionHistory(historyData) {
  const { history = [], total = 0, page = 1, totalPages = 1 } = historyData;

  if (history.length === 0) {
    document.getElementById('history-container').innerHTML = `
      <div style="padding:40px;text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:var(--muted);">
        <div style="font-size:14px;">📭 Aucun historique disponible</div>
      </div>
    `;
    return;
  }

  const actionColors = {
    GRANT: 'var(--green)',
    REVOKE: 'var(--red)',
    ROLLBACK: 'var(--yellow)',
  };

  let html = '<div style="display:flex;flex-direction:column;gap:12px;">';

  history.forEach(entry => {
    const actionColor = actionColors[entry.action] || 'var(--blue)';
    const changedBy = entry.changedBy ? `${entry.changedBy.firstName || ''} ${entry.changedBy.lastName || ''}`.trim() || entry.changedBy.email : 'Administrateur';

    const prevPerms = entry.previousPermissions || {};
    const newPerms = entry.newPermissions || {};

    const permChanges = [];
    ['canCreate', 'canRead', 'canUpdate', 'canDelete'].forEach(perm => {
      if (prevPerms[perm] !== newPerms[perm]) {
        const permLabel = { canCreate: 'Créer', canRead: 'Lire', canUpdate: 'Modifier', canDelete: 'Supprimer' }[perm];
        const status = newPerms[perm] ? '✅' : '❌';
        permChanges.push(`${permLabel} ${status}`);
      }
    });

    html += `
      <div style="background:var(--dark4);border-left:3px solid ${actionColor};border-radius:8px;padding:14px;transition:all .2s;">
        <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:8px;">
          <div>
            <span class="badge" style="background:${actionColor};color:#fff;border:none;margin-right:8px;text-transform:uppercase;font-size:10px;">${entry.action}</span>
            <span style="font-size:12px;color:var(--muted);">Section:</span>
            <strong style="font-size:13px;color:var(--white);margin-left:4px;font-family:monospace;">${escHtml(entry.section)}</strong>
          </div>
          <div style="text-align:right;font-size:11px;color:var(--muted);">
            <div>${formatDate(entry.createdAt)}</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--light);margin-bottom:8px;">
          Par: <strong>${escHtml(changedBy)}</strong>
        </div>
        ${entry.reason ? `<div style="font-size:11px;color:var(--muted);margin-bottom:8px;padding:8px;background:rgba(255,255,255,0.02);border-radius:6px;border-left:2px solid rgba(255,255,255,0.1);">📝 ${escHtml(entry.reason)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">
          ${permChanges.length > 0 ? permChanges.map(p => `<span style="font-size:11px;background:rgba(255,255,255,0.08);padding:4px 8px;border-radius:4px;color:var(--light);">${p}</span>`).join('') : '<span style="font-size:11px;color:var(--muted);">Aucun changement de permission</span>'}
        </div>
        ${entry.action === 'GRANT' || entry.action === 'REVOKE' ? `
          <button onclick="window.RolePermissions.openRollbackModal('${entry.id}', '${entry.action}')" style="margin-top:10px;padding:6px 12px;font-size:11px;background:rgba(245,158,11,0.15);color:var(--yellow);border:1px solid rgba(245,158,11,0.3);border-radius:6px;cursor:pointer;font-weight:600;transition:all .2s;" onmouseover="this.style.background='rgba(245,158,11,0.25)'" onmouseout="this.style.background='rgba(245,158,11,0.15)'">
            ⏮️ Rollback
          </button>
        ` : ''}
      </div>
    `;
  });

  html += '</div>';

  // Pagination
  if (totalPages > 1) {
    html += `
      <div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);">
        <button onclick="window.RolePermissions.historyPrevPage()" ${page <= 1 ? 'disabled' : ''} style="padding:8px 12px;background:var(--dark4);color:${page <= 1 ? 'var(--muted)' : 'var(--light)'};border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:${page <= 1 ? 'default' : 'pointer'};font-weight:600;transition:all .2s;">← Précédent</button>
        <span style="font-size:12px;color:var(--muted);">Page ${page} / ${totalPages}</span>
        <button onclick="window.RolePermissions.historyNextPage()" ${page >= totalPages ? 'disabled' : ''} style="padding:8px 12px;background:var(--dark4);color:${page >= totalPages ? 'var(--muted)' : 'var(--light)'};border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:${page >= totalPages ? 'default' : 'pointer'};font-weight:600;transition:all .2s;">Suivant →</button>
      </div>
    `;
  }

  document.getElementById('history-container').innerHTML = html;
}

export async function openRollbackModal(historyId, originalAction) {
  const modalBody = `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">
        Vous êtes sur le point d'annuler une modification de permissions. Cette action :
      </div>
      <ul style="font-size:12px;color:var(--light);line-height:1.8;margin:0;padding-left:20px;">
        <li>Restaure les permissions à l'état précédent</li>
        <li>Enregistre le rollback dans l'historique</li>
        <li>Peut être à nouveau annulé ultérieurement</li>
      </ul>
    </div>

    <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;margin-bottom:20px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;font-weight:600;">Raison du rollback (optionnel)</div>
      <textarea id="rollback-reason" placeholder="Expliquez pourquoi cette annulation..." style="width:100%;padding:10px;background:var(--dark4);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--white);font-family:'DM Sans',sans-serif;font-size:12px;resize:vertical;min-height:60px;box-sizing:border-box;"></textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
      <button onclick="window.RolePermissions.performRollback('${historyId}')" style="padding:11px 16px;background:var(--yellow);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;font-size:13px;transition:all .2s;" onmouseover="this.style.background='#FBBF24'" onmouseout="this.style.background='var(--yellow)'">
        ⏮️ Confirmer le rollback
      </button>
      <button onclick="window.closeModal('modal-rollback-confirm')" style="padding:11px 16px;background:var(--dark4);color:var(--light);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;font-size:13px;transition:all .2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='var(--dark4)'">
        Annuler
      </button>
    </div>
  `;

  document.getElementById('rollback-modal-body').innerHTML = modalBody;
  openModal('modal-rollback-confirm');

  // Stocker le historyId dans une variable globale accessible
  window._rollbackHistoryId = historyId;
}

export async function performRollback(historyId) {
  if (!currentRoleId) return;

  try {
    const reason = document.getElementById('rollback-reason')?.value || '';

    await apiCall(`/role-permissions/rollback/${currentRoleId}/${historyId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });

    showToast('✅ Rollback effectué avec succès', false);
    closeModal('modal-rollback-confirm');

    // Recharger les permissions et historique
    await selectRole(currentRoleId);
  } catch (err) {
    showToast('Erreur: ' + err.message, true);
  }
}

// ══════════════════════════════════════════════════════════════
// UI HELPERS & PAGINATION
// ══════════════════════════════════════════════════════════════

export function selectPermissionTab(tabName) {
  document.querySelectorAll('.perm-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.perm-tab-content').forEach(tab => tab.style.display = 'none');

  const btn = document.querySelector(`[data-tab="${tabName}"]`);
  const tab = document.getElementById(`perm-${tabName}`);

  if (btn) btn.classList.add('active');
  if (tab) tab.style.display = 'block';
}

export async function historyNextPage() {
  if (currentRoleId) {
    currentHistoryPage++;
    await loadPermissionHistory();
  }
}

export async function historyPrevPage() {
  if (currentRoleId && currentHistoryPage > 1) {
    currentHistoryPage--;
    await loadPermissionHistory();
  }
}

// ══════════════════════════════════════════════════════════════
// EXPORT MODULE
// ══════════════════════════════════════════════════════════════

export const RolePermissions = {
  load,
  selectRole,
  displayRoleInfo,
  displayPermissionsGrid,
  openSectionModal,
  updatePermissions,
  revokeAction,
  loadPermissionHistory,
  displayPermissionHistory,
  openRollbackModal,
  performRollback,
  selectPermissionTab,
  historyNextPage,
  historyPrevPage,
};
