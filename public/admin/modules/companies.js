// Companies Module - Entreprises Management
import { apiCall, loadModuleTable, debounceModuleTableSearch } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

export async function loadCompanies(page = 1) {
  return loadModuleTable({
    endpoint: '/api/companies?page={page}&limit={limit}',
    selector: {
      tbody: 'companies-tbody',
      empty: 'companies-empty',
      pagination: 'companies-pagination',
    },
    columns: [
      { key: 'companyName', label: 'Entreprise', render: (val) => `<strong>${escHtml(val)}</strong>` },
      {
        key: 'user',
        label: 'Contact',
        render: (val) => {
          const name = val ? `${val.firstName} ${val.lastName}` : '—';
          const email = val?.email || '';
          return `<strong>${escHtml(name)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(email)}</span>`;
        },
      },
      {
        key: 'trades',
        label: 'Domaines',
        render: (val) => escHtml((val || []).join(', ') || '—'),
      },
      {
        key: 'trustScore',
        label: 'Score',
        render: (val) => `<strong style="color:var(--orange);">${(val || 0).toFixed(0)}</strong>`,
      },
      { key: 'createdAt', label: 'Inscrite', render: (val) => formatDate(val) },
    ],
    onRowClick: (row) => window.Companies.openCompanyDetail(row.id),
    searchInput: 'companies-search',
  }, page);
}

export async function openCompanyDetail(companyId) {
  setState('_currentCompanyId', companyId);
  try {
    const company = await apiCall('/api/companies/' + companyId);
    if (!company) { showToast('Entreprise introuvable', true); return; }

    const contactName = company.user ? `${company.user.firstName} ${company.user.lastName}` : '—';
    const trades = (company.trades || []).join(', ') || 'Non spécifié';
    const avgRating = company.averageRating ? company.averageRating.toFixed(1) : '—';
    const reviewCount = company.reviewCount || 0;

    const body = `<div style="margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Entreprise</div>
      <div style="font-size:16px;font-weight:700;">${escHtml(company.companyName)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Contact</div>
        <div style="font-size:13px;font-weight:600;">${escHtml(contactName)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(company.user?.email || '')}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(company.user?.phone || '')}</div>
      </div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Notation</div>
        <div style="font-size:16px;font-weight:700;color:var(--green);">${avgRating} ⭐</div>
        <div style="font-size:11px;color:var(--muted);">${reviewCount} avis</div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Domaines</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(trades)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Score de confiance</div>
        <div style="font-size:16px;font-weight:700;color:var(--orange);">${(company.trustScore || 0).toFixed(0)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Inscrite</div>
        <div style="font-size:12px;font-weight:600;">${formatDate(company.createdAt)}</div>
      </div>
    </div>`;

    document.getElementById('companies-modal-body').innerHTML = body;

    let actionButtons = `
      <button class="btn btn-view" onclick="window.Companies.viewProfessionals('${companyId}')" style="flex:1;">👥 Voir équipe</button>
      <button class="btn btn-secondary" onclick="closeModal('modal-company')" style="flex:1;">Fermer</button>
    `;
    document.getElementById('companies-modal-actions').innerHTML = actionButtons;

    openModal('modal-company');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export function viewProfessionals(companyId) {
  // Navigate to professionals page filtered by company
  window.navigateTo('professionals');
  setTimeout(() => {
    const filter = document.getElementById('professionals-company-filter');
    if (filter) {
      filter.value = companyId;
      window.Professionals.loadProfessionals(1);
    }
  }, 100);
}

export function debounceLoadCompanies() {
  debounceModuleTableSearch(
    {
      endpoint: '/api/companies?page={page}&limit={limit}',
      selector: {
        tbody: 'companies-tbody',
        empty: 'companies-empty',
        pagination: 'companies-pagination',
      },
      columns: [
        { key: 'companyName', label: 'Entreprise', render: (val) => `<strong>${escHtml(val)}</strong>` },
        {
          key: 'user',
          label: 'Contact',
          render: (val) => {
            const name = val ? `${val.firstName} ${val.lastName}` : '—';
            const email = val?.email || '';
            return `<strong>${escHtml(name)}</strong><br><span style="color:var(--muted);font-size:11px;">${escHtml(email)}</span>`;
          },
        },
        {
          key: 'trades',
          label: 'Domaines',
          render: (val) => escHtml((val || []).join(', ') || '—'),
        },
        {
          key: 'trustScore',
          label: 'Score',
          render: (val) => `<strong style="color:var(--orange);">${(val || 0).toFixed(0)}</strong>`,
        },
        { key: 'createdAt', label: 'Inscrite', render: (val) => formatDate(val) },
      ],
      onRowClick: (row) => window.Companies.openCompanyDetail(row.id),
      searchInput: 'companies-search',
    },
    'companies',
    300
  );
}

export const Companies = {
  loadCompanies,
  openCompanyDetail,
  viewProfessionals,
  debounceLoadCompanies,
};
