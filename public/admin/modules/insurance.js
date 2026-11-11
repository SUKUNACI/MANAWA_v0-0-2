// Insurance Module - Gestion assurance artisans
import { apiCall, loadModuleTable } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

const STATUS_DISPLAY = {
  active: { label: '✅ Actif', color: '#22C55E' },
  expired: { label: '❌ Expiré', color: '#EF4444' },
  pending: { label: '⏳ En attente', color: '#F59E0B' },
};

export async function loadInsuranceData(page = 1) {
  const result = await loadModuleTable({
    endpoint: '/admin/insurance?page={page}&limit={limit}',
    selector: {
      tbody: 'insurance-tbody',
      pagination: 'insurance-pagination',
    },
    columns: [
      {
        key: 'professional',
        label: 'Professionnel',
        render: (val) => `<strong>${escHtml(val?.firstName || '')}</strong>`,
      },
      {
        key: 'policyNumber',
        label: 'N° Police',
        render: (val) => escHtml(val || '—'),
      },
      {
        key: 'coverage',
        label: 'Couverture',
        render: (val) => `<strong>${(val || 0).toLocaleString('fr-FR')} XOF</strong>`,
      },
      {
        key: 'status',
        label: 'Statut',
        render: (val) => {
          const display = STATUS_DISPLAY[val] || { label: val, color: '#999' };
          return `<span style="display:inline-block;background:${display.color};color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;">${display.label}</span>`;
        },
      },
      {
        key: 'expiryDate',
        label: 'Expiration',
        render: (val) => formatDate(val),
      },
    ],
    onRowClick: (row) => window.Insurance.openInsuranceDetail(row.id),
  }, page);

  // Update total display
  if (document.getElementById('insurance-total')) {
    document.getElementById('insurance-total').textContent = result.total;
  }

  return result;
}

export async function openInsuranceDetail(recordId) {
  try {
    const res = await apiCall('/admin/insurance/' + recordId);
    if (!res) { showToast('Assurance introuvable', true); return; }

    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Professionnel</div>
        <div style="font-size:12px;font-weight:600;">${escHtml(res.professional?.firstName || '')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Couverture</div>
        <div style="font-size:14px;font-weight:700;">${(res.coverage || 0).toLocaleString('fr-FR')} XOF</div>
      </div>
    </div>`;

    document.getElementById('insurance-modal-body').innerHTML = body;
    openModal('modal-insurance');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const Insurance = {
  loadInsuranceData,
  openInsuranceDetail,
};
