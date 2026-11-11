// Packages Module - Gestion des forfaits (suspension, réactivation, signalements)
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════

const state = {
  currentPage: 1,
  limit: 50,
  filters: {
    status: '',
    search: ''
  },
  selectedPackageIds: [],
  currentPackageId: null,
  packages: []
};

// ════════════════════════════════════════════════════════════════
// LOAD PACKAGES
// ════════════════════════════════════════════════════════════════

export async function load(page = 1) {
  try {
    state.currentPage = page;
    const status = document.getElementById('packages-status')?.value || '';
    const search = document.getElementById('packages-search')?.value || '';

    let url = `/api/admin/packages?page=${page}&limit=${state.limit}`;
    if (status) url += `&status=${status}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await apiCall(url);
    const packages = res.packages || [];
    const total = res.total || 0;
    const totalPages = res.totalPages || 1;

    state.packages = packages;
    state.filters.status = status;
    state.filters.search = search;

    renderPackagesTable(packages);

    // Render pagination
    let paginationHtml = '';
    if (totalPages > 1) {
      if (page > 1) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Packages.load(1)">⏮️ Première</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Packages.load(${page - 1})">◀️ Précédente</button>`;
      }
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${page} / ${totalPages}</span>`;
      if (page < totalPages) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Packages.load(${page + 1})">Suivante ▶️</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window.Packages.load(${totalPages})">Dernière ⏭️</button>`;
      }
    }
    document.getElementById('packages-pagination').innerHTML = paginationHtml;

    // Show/hide empty state
    document.getElementById('packages-empty').style.display = packages.length === 0 ? 'block' : 'none';

  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

// ════════════════════════════════════════════════════════════════
// RENDER TABLE
// ════════════════════════════════════════════════════════════════

function renderPackagesTable(packages) {
  if (packages.length === 0) {
    document.getElementById('packages-tbody').innerHTML = '';
    return;
  }

  const html = packages.map(pkg => {
    const isSelected = state.selectedPackageIds.includes(pkg.id);
    const statusBadge = pkg.active ? '🟢 Actif' : '🔴 Suspendu';
    const statusColor = pkg.active ? '#22C55E' : '#EF4444';
    const flaggedCount = (pkg.abuseFlags || []).length;
    const flaggedBadge = flaggedCount > 0 ? `🚩 ${flaggedCount}` : '✅';
    const priceDisplay = pkg.price ? `${pkg.price.toLocaleString('fr-FR')} FCFA` : '—';
    const ordersCount = pkg.ordersCount || 0;
    const disputeRate = pkg.disputeRate || '0';

    const proName = pkg.professional
      ? `${pkg.professional.firstName} ${pkg.professional.lastName}`
      : '—';

    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
      <td style="padding:10px 12px;width:30px;">
        <input type="checkbox" class="package-checkbox" data-id="${pkg.id}" onchange="window.Packages.togglePackageSelection('${pkg.id}')" style="accent-color:var(--blue);cursor:pointer;" ${isSelected ? 'checked' : ''} />
      </td>
      <td style="padding:10px 12px;font-size:12px;">
        <strong>${escHtml(pkg.title || '—')}</strong><br>
        <span style="color:var(--muted);font-size:11px;">${escHtml(pkg.category || 'Sans catégorie')}</span>
      </td>
      <td style="padding:10px 12px;font-size:12px;">
        <strong>${escHtml(proName)}</strong><br>
        <span style="color:var(--muted);font-size:11px;">${escHtml(pkg.professional?.email || '')}</span>
      </td>
      <td style="padding:10px 12px;font-size:12px;font-weight:600;">${priceDisplay}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;">${ordersCount}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:var(--yellow);">${disputeRate}%</td>
      <td style="padding:10px 12px;text-align:center;">
        <span style="color:${statusColor};font-weight:600;font-size:11px;">${statusBadge}</span>
      </td>
      <td style="padding:10px 12px;text-align:center;font-size:11px;">${flaggedBadge}</td>
      <td style="padding:10px 12px;text-align:center;">
        <button class="btn btn-view" onclick="window.Packages.viewHistory('${pkg.id}')" style="padding:4px 8px;font-size:10px;">📜</button>
      </td>
      <td style="padding:10px 12px;text-align:center;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-view" onclick="window.Packages.viewDetail('${pkg.id}')" style="padding:4px 8px;font-size:10px;">👁️</button>
          ${pkg.active
            ? `<button class="btn btn-approve" onclick="window.Packages.openSuspendModal('${pkg.id}')" style="padding:4px 8px;font-size:10px;">🚫</button>`
            : `<button class="btn btn-secondary" onclick="window.Packages.reactivate('${pkg.id}')" style="padding:4px 8px;font-size:10px;">✅</button>`
          }
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('packages-tbody').innerHTML = html;
}

// ════════════════════════════════════════════════════════════════
// HANDLERS - SUSPEND / REACTIVATE / BULK
// ════════════════════════════════════════════════════════════════

export async function suspend(packageId, reason) {
  try {
    if (!packageId || !reason) {
      showToast('Paramètres manquants', true);
      return;
    }

    await apiCall(`/api/admin/packages/${packageId}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });

    showToast('✅ Forfait suspendu');
    closeModal('modal-suspend-package');
    await load(state.currentPage);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function reactivate(packageId) {
  if (!confirm('Êtes-vous sûr de réactiver ce forfait?')) return;

  try {
    await apiCall(`/api/admin/packages/${packageId}/reactivate`, {
      method: 'PATCH',
      body: JSON.stringify({})
    });

    showToast('✅ Forfait réactivé');
    await load(state.currentPage);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function bulkSuspend(packageIds, reason) {
  try {
    if (!Array.isArray(packageIds) || packageIds.length === 0 || !reason) {
      showToast('Paramètres invalides', true);
      return;
    }

    await apiCall(`/api/admin/packages/bulk/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ packageIds, reason })
    });

    showToast(`✅ ${packageIds.length} forfait(s) suspendu(s)`);
    clearPackageSelection();
    await load(state.currentPage);
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

// ════════════════════════════════════════════════════════════════
// SELECTION & BULK ACTIONS
// ════════════════════════════════════════════════════════════════

export function togglePackageSelection(packageId) {
  if (state.selectedPackageIds.includes(packageId)) {
    state.selectedPackageIds = state.selectedPackageIds.filter(id => id !== packageId);
  } else {
    state.selectedPackageIds.push(packageId);
  }
  updateBulkBar();
}

export function toggleSelectAllPackages() {
  const checkbox = document.getElementById('packages-select-all');
  if (checkbox?.checked) {
    state.selectedPackageIds = state.packages.map(p => p.id);
  } else {
    state.selectedPackageIds = [];
  }
  updateBulkBar();
  renderPackagesTable(state.packages);
}

export function clearPackageSelection() {
  state.selectedPackageIds = [];
  document.getElementById('packages-select-all').checked = false;
  updateBulkBar();
  renderPackagesTable(state.packages);
}

function updateBulkBar() {
  const bulkBar = document.getElementById('packages-bulk-bar');
  const selectedCount = state.selectedPackageIds.length;

  if (selectedCount === 0) {
    bulkBar.style.display = 'none';
  } else {
    bulkBar.style.display = 'flex';
    document.getElementById('packages-selected-count').textContent = selectedCount;
  }

  // Update checkboxes
  document.querySelectorAll('.package-checkbox').forEach(cb => {
    cb.checked = state.selectedPackageIds.includes(cb.dataset.id);
  });
}

// ════════════════════════════════════════════════════════════════
// MODALS & DETAILS
// ════════════════════════════════════════════════════════════════

export async function viewDetail(packageId) {
  try {
    const pkg = await apiCall(`/api/admin/packages/${packageId}`);
    if (!pkg) {
      showToast('Forfait introuvable', true);
      return;
    }

    state.currentPackageId = packageId;

    const proName = pkg.professional
      ? `${pkg.professional.firstName} ${pkg.professional.lastName}`
      : '—';

    const abuseFlags = (pkg.abuseFlags || []).length > 0
      ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:12px;">
          <p style="font-size:11px;color:var(--red);font-weight:600;margin:0 0 8px 0;">🚩 SIGNALEMENTS DÉTECTÉS:</p>
          <ul style="margin:0;padding-left:16px;font-size:11px;color:var(--light);">
            ${pkg.abuseFlags.map(f => `<li>${escHtml(f)}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Titre</div>
          <div style="font-size:13px;font-weight:600;">${escHtml(pkg.title || '—')}</div>
        </div>
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Catégorie</div>
          <div style="font-size:13px;font-weight:600;">${escHtml(pkg.category || '—')}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Prix</div>
          <div style="font-size:16px;font-weight:700;color:var(--green);">${pkg.price ? pkg.price.toLocaleString('fr-FR') + ' FCFA' : '—'}</div>
        </div>
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Durée</div>
          <div style="font-size:13px;font-weight:600;">${escHtml(pkg.duration || '—')}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Ventes</div>
          <div style="font-size:16px;font-weight:700;">${pkg.ordersCount || 0}</div>
        </div>
        <div style="background:var(--dark4);border-radius:10px;padding:12px;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Litiges %</div>
          <div style="font-size:16px;font-weight:700;color:var(--orange);">${pkg.disputeRate || '0'}%</div>
        </div>
      </div>

      <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Professionnel</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(proName)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(pkg.professional?.email || '')}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(pkg.professional?.companyName || '')}</div>
      </div>

      <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Description</div>
        <div style="font-size:12px;color:var(--light);">${escHtml(pkg.description || '—')}</div>
      </div>

      ${abuseFlags}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;font-size:11px;color:var(--muted);">
        <div>Créé: ${formatDate(pkg.createdAt)}</div>
        <div>Modifié: ${formatDate(pkg.updatedAt)}</div>
      </div>
    `;

    document.getElementById('packages-modal-body').innerHTML = body;

    let actionButtons = `
      ${pkg.active
        ? `<button class="btn btn-approve" onclick="window.Packages.openSuspendModal('${pkg.id}')" style="flex:1;">🚫 Suspendre</button>`
        : `<button class="btn btn-secondary" onclick="window.Packages.reactivate('${pkg.id}')" style="flex:1;">✅ Réactiver</button>`
      }
      <button class="btn btn-secondary" onclick="closeModal('modal-package')" style="flex:1;">Fermer</button>
    `;

    document.getElementById('packages-modal-actions').innerHTML = actionButtons;

    openModal('modal-package');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function viewHistory(packageId) {
  try {
    const history = await apiCall(`/api/admin/packages/${packageId}/history`);
    const logs = history.logs || [];

    if (logs.length === 0) {
      showToast('Aucun historique disponible', false);
      return;
    }

    const html = logs.map(log => {
      const actionLabel = {
        'SUSPEND': '🚫 Suspension',
        'REACTIVATE': '✅ Réactivation'
      }[log.action] || log.action;

      return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;">${actionLabel}</span>
          <span style="font-size:10px;color:var(--muted);">${formatDate(log.createdAt)}</span>
        </div>
        <div style="font-size:11px;color:var(--light);">
          ${log.reason ? `<strong>Raison:</strong> ${escHtml(log.reason)}` : '—'}
        </div>
      </div>`;
    }).join('');

    const body = `<div style="display:flex;flex-direction:column;gap:8px;">${html}</div>`;

    document.getElementById('packages-history-modal-body').innerHTML = body;
    openModal('modal-package-history');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function openSuspendModal(packageId) {
  state.currentPackageId = packageId;
  openModal('modal-suspend-package');
}

export function confirmSuspendPackage() {
  const selectedReason = document.querySelector('input[name="suspend-reason"]:checked')?.value;
  const customReason = document.getElementById('suspend-reason-custom')?.value?.trim() || '';

  if (!selectedReason) {
    showToast('Sélectionnez une raison', true);
    return;
  }

  let finalReason = selectedReason;
  if (selectedReason === 'Autre' && customReason) {
    finalReason = `Autre: ${customReason}`;
  } else if (customReason) {
    finalReason = `${selectedReason} - ${customReason}`;
  }

  suspend(state.currentPackageId, finalReason);
}

export function openBulkSuspendModal() {
  if (state.selectedPackageIds.length === 0) {
    showToast('Sélectionnez au moins un forfait', true);
    return;
  }

  // Reset the modal
  document.querySelectorAll('input[name="suspend-reason"]').forEach(r => r.checked = false);
  document.getElementById('suspend-reason-custom').value = '';

  openModal('modal-suspend-package-bulk');
}

export function confirmBulkSuspendPackage() {
  const selectedReason = document.querySelector('input[name="suspend-reason-bulk"]:checked')?.value;
  const customReason = document.getElementById('suspend-reason-custom-bulk')?.value?.trim() || '';

  if (!selectedReason) {
    showToast('Sélectionnez une raison', true);
    return;
  }

  let finalReason = selectedReason;
  if (selectedReason === 'Autre' && customReason) {
    finalReason = `Autre: ${customReason}`;
  } else if (customReason) {
    finalReason = `${selectedReason} - ${customReason}`;
  }

  bulkSuspend(state.selectedPackageIds, finalReason);
}

// ════════════════════════════════════════════════════════════════
// SEARCH & DEBOUNCE
// ════════════════════════════════════════════════════════════════

export function debouncePackages() {
  clearTimeout(window._packagesSearchTimer);
  window._packagesSearchTimer = setTimeout(() => load(1), 300);
}

// ════════════════════════════════════════════════════════════════
// EXPORT CSV
// ════════════════════════════════════════════════════════════════

export function exportPackagesCSV() {
  if (state.packages.length === 0) {
    showToast('Aucun forfait à exporter', true);
    return;
  }

  const headers = ['ID', 'Titre', 'Catégorie', 'Prix', 'Professionnel', 'Email', 'Ventes', 'Litiges %', 'Statut', 'Signalements', 'Créé'];
  const rows = state.packages.map(pkg => {
    const status = pkg.active ? 'Actif' : 'Suspendu';
    const flags = (pkg.abuseFlags || []).length;
    const proName = pkg.professional ? `${pkg.professional.firstName} ${pkg.professional.lastName}` : '';
    const proEmail = pkg.professional?.email || '';

    return [
      pkg.id,
      pkg.title || '',
      pkg.category || '',
      pkg.price || '',
      proName,
      proEmail,
      pkg.ordersCount || 0,
      pkg.disputeRate || '0',
      status,
      flags,
      new Date(pkg.createdAt).toLocaleDateString('fr-FR')
    ];
  });

  // Build CSV
  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  // Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `forfaits_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();

  showToast('✅ Export CSV téléchargé');
}

// ════════════════════════════════════════════════════════════════
// MODULE EXPORT
// ════════════════════════════════════════════════════════════════

export const Packages = {
  load,
  suspend,
  reactivate,
  bulkSuspend,
  togglePackageSelection,
  toggleSelectAllPackages,
  clearPackageSelection,
  viewDetail,
  viewHistory,
  openSuspendModal,
  confirmSuspendPackage,
  openBulkSuspendModal,
  confirmBulkSuspendPackage,
  debouncePackages,
  exportPackagesCSV
};
