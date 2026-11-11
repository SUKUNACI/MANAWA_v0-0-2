// Companies Module - Entreprises Management
import { apiCall } from './api.js';
import { setState, getState } from './state.js';
import { showToast, openModal, closeModal, escHtml, formatDate, debounce } from './ui.js';

export async function loadCompanies(page = 1) {
  try {
    const search = document.getElementById('companies-search')?.value || '';

    let url = '/api/companies?page=' + page + '&limit=50';
    if (search) url += '&search=' + encodeURIComponent(search);

    const res = await apiCall(url);
    const { companies = [], total = 0, page: currentPage = 1, totalPages = 1 } = res;

    let html = companies.length === 0 ? '' : companies.map(c => {
      const contactName = c.user ? `${c.user.firstName} ${c.user.lastName}` : '—';
      const trades = (c.trades || []).join(', ') || '—';

      return `<tr onclick="window.Companies.openCompanyDetail('${c.id}')" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(c.companyName)}</strong></td>
        <td style="padding:10px 12px;font-size:12px;">
          <strong>${escHtml(contactName)}</strong><br>
          <span style="color:var(--muted);font-size:11px;">${escHtml(c.user?.email || '')}</span>
        </td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(trades)}</td>
        <td style="padding:10px 12px;text-align:center;">
          <strong style="color:var(--orange);">${(c.trustScore || 0).toFixed(0)}</strong>
        </td>
        <td style="padding:10px 12px;font-size:11px;">${formatDate(c.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('companies-tbody').innerHTML = html;
    document.getElementById('companies-empty').style.display = companies.length === 0 ? 'block' : 'none';

    let paginationHtml = '';
    if (totalPages > 1) {
      if (currentPage > 1) paginationHtml += `<button class="btn btn-secondary" onclick="window.Companies.loadCompanies(1)">⏮️ Première</button><button class="btn btn-secondary" onclick="window.Companies.loadCompanies(${currentPage - 1})">◀️ Précédente</button>`;
      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;
      if (currentPage < totalPages) paginationHtml += `<button class="btn btn-secondary" onclick="window.Companies.loadCompanies(${currentPage + 1})">Suivante ▶️</button><button class="btn btn-secondary" onclick="window.Companies.loadCompanies(${totalPages})">Dernière ⏭️</button>`;
    }
    document.getElementById('companies-pagination').innerHTML = paginationHtml;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
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
  clearTimeout(window._companiesSearchTimer);
  window._companiesSearchTimer = setTimeout(() => loadCompanies(1), 300);
}

export const Companies = {
  loadCompanies,
  openCompanyDetail,
  viewProfessionals,
  debounceLoadCompanies,
};
