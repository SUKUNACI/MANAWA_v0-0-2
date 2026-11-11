/**
 * MANAWA Admin Panel - Helpers Library (Barrel Export)
 * Central re-export of all helpers from modular components
 * Version 2.0 - Refactored into 4 focused modules
 *
 * MODULES:
 * - helpers-ui.js: Modal, Toast, Safe HTML creation
 * - helpers-table.js: Table rendering and styles
 * - helpers-form.js: Validation, debounce, throttle
 * - helpers-data.js: API calls, CSRF, date/currency formatting
 */

// ============================================================================
// Module Imports (These are loaded by separate script tags in HTML)
// ============================================================================

// helpers-ui.js: openModal, closeModal, setupModalBackdropClose,
//                initToastContainer, showToast, escapeHtml,
//                createSafeElement, initializeUiAnimations

// helpers-table.js: renderTable, initializeTableStyles

// helpers-form.js: validateEmail, validatePhoneNumber, validateUrl,
//                  validateNumberRange, validateRequired, debounce, throttle

// helpers-data.js: apiCall, getCsrfToken, verifyCsrfToken,
//                  formatDate, formatRelativeTime, formatCurrency, formatNumber

// ============================================================================
// Generic Module Table Loader - DRY pattern (eliminates 20+ repetitions)
// ============================================================================

/**
 * Generic table loader for admin modules - eliminates repetitive table setup code
 *
 * Pattern: All admin modules repeat the same load logic:
 * 1. Fetch paginated data from API
 * 2. Map rows to HTML table
 * 3. Render pagination
 * 4. Handle errors
 *
 * @param {Object} config - Configuration object
 *   - endpoint: API endpoint URL (supports {page} and {limit} placeholders)
 *   - selector: { tbody, empty, pagination } - DOM selectors
 *   - columns: Array of column configs:
 *       { key, label, render(value, row) }
 *   - onRowClick: Optional callback when row is clicked
 *   - searchInput: Optional DOM selector for search input
 *   - filters: Optional array of { key, input } for additional filters
 *   - pageParam: Optional custom page parameter name (default 'page')
 *   - limitParam: Optional custom limit parameter name (default 'limit')
 *   - limit: Optional custom limit (default 50)
 * @param {number} page - Current page number (default 1)
 * @returns {Promise<Object>} - { items, total, page, totalPages }
 *
 * USAGE EXAMPLE:
 *
 *   export async function loadCompanies(page = 1) {
 *     return loadModuleTable({
 *       endpoint: '/api/companies?page={page}&limit={limit}',
 *       selector: {
 *         tbody: 'companies-tbody',
 *         empty: 'companies-empty',
 *         pagination: 'companies-pagination',
 *       },
 *       columns: [
 *         { key: 'companyName', label: 'Entreprise' },
 *         { key: 'email', label: 'Email' },
 *         {
 *           key: 'trustScore',
 *           label: 'Score',
 *           render: (val) => `<strong>${val.toFixed(0)}</strong>`,
 *         },
 *       ],
 *       onRowClick: (row) => window.Companies.openDetail(row.id),
 *       searchInput: 'companies-search',
 *     }, page);
 *   }
 */
async function loadModuleTable(config, page = 1) {
  const {
    endpoint,
    selector = {},
    columns = [],
    onRowClick = null,
    searchInput = null,
    filters = [],
    pageParam = 'page',
    limitParam = 'limit',
    limit = 50,
  } = config;

  try {
    // Build URL with pagination and search
    let url = endpoint
      .replace('{page}', page)
      .replace('{limit}', limit);

    // Add search parameter if provided
    if (searchInput) {
      const searchValue = document.getElementById(searchInput)?.value || '';
      if (searchValue) {
        const separator = url.includes('?') ? '&' : '?';
        url += separator + 'search=' + encodeURIComponent(searchValue);
      }
    }

    // Add additional filters
    if (filters && filters.length > 0) {
      filters.forEach((filter) => {
        const value = document.getElementById(filter.input)?.value || '';
        if (value) {
          const separator = url.includes('?') ? '&' : '?';
          url += separator + filter.key + '=' + encodeURIComponent(value);
        }
      });
    }

    // Fetch data
    const res = await apiCall(url);

    // Extract data from response (support multiple response structures)
    let items = [];
    let total = 0;
    let currentPage = page;
    let totalPages = 1;

    if (Array.isArray(res)) {
      // Response is direct array
      items = res;
      total = res.length;
      totalPages = 1;
    } else if (typeof res === 'object' && res !== null) {
      // Response is object with data properties
      const dataKey = Object.keys(res).find(
        (k) =>
          Array.isArray(res[k]) &&
          (k.includes('item') ||
            k.includes('data') ||
            k.includes('result') ||
            k.endsWith('s'))
      ) || 'items';

      items = res[dataKey] || res.data || res.results || [];
      total = res.total || res.count || items.length;
      currentPage = res[pageParam] || res.page || page;
      totalPages = res[limitParam] || res.totalPages || 1;
    }

    // Render table body
    if (selector.tbody) {
      let html = '';

      if (items.length === 0) {
        // Show empty state
        if (selector.empty) {
          document.getElementById(selector.empty).style.display = 'block';
        }
      } else {
        // Show items
        if (selector.empty) {
          document.getElementById(selector.empty).style.display = 'none';
        }

        html = items
          .map((row, idx) => {
            let cellsHtml = '';

            // Render columns
            columns.forEach((col) => {
              const value = row[col.key];
              let cellContent = '';

              if (col.render && typeof col.render === 'function') {
                cellContent = col.render(value, row);
              } else {
                cellContent = escapeHtml(
                  value !== undefined && value !== null ? String(value) : '—'
                );
              }

              cellsHtml += `<td style="padding:10px 12px;font-size:12px;">${cellContent}</td>`;
            });

            // Wrap in row
            const rowClick = onRowClick ? `onclick="window._handleModuleRowClick(${idx}, event)"` : '';
            const rowHoverStyle = onRowClick ? 'cursor:pointer;' : '';

            return `<tr data-row-index="${idx}" ${rowClick} style="${rowHoverStyle}border-bottom:1px solid rgba(255,255,255,0.08);" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='transparent'">${cellsHtml}</tr>`;
          })
          .join('');
      }

      document.getElementById(selector.tbody).innerHTML = html;

      // Store row data for click handlers
      if (onRowClick) {
        window._lastModuleTableRows = items;
        window._handleModuleRowClick = (idx) => {
          onRowClick(items[idx]);
        };
      }
    }

    // Render pagination
    if (selector.pagination && totalPages > 1) {
      let paginationHtml = '';

      if (currentPage > 1) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window._moduleTableLoadPage(1)">⏮️ Première</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window._moduleTableLoadPage(${currentPage - 1})">◀️ Précédente</button>`;
      }

      paginationHtml += `<span style="align-self:center;font-size:12px;color:var(--muted);">Page ${currentPage} / ${totalPages}</span>`;

      if (currentPage < totalPages) {
        paginationHtml += `<button class="btn btn-secondary" onclick="window._moduleTableLoadPage(${currentPage + 1})">Suivante ▶️</button>`;
        paginationHtml += `<button class="btn btn-secondary" onclick="window._moduleTableLoadPage(${totalPages})">Dernière ⏭️</button>`;
      }

      document.getElementById(selector.pagination).innerHTML = paginationHtml;

      // Store current loader for pagination
      window._lastModuleTableLoader = () => loadModuleTable(config, currentPage);
      window._moduleTableLoadPage = (newPage) => loadModuleTable(config, newPage);
    } else if (selector.pagination) {
      document.getElementById(selector.pagination).innerHTML = '';
    }

    return { items, total, page: currentPage, pages: totalPages };
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
    if (selector.tbody) {
      document.getElementById(selector.tbody).innerHTML = '';
    }
    return { items: [], total: 0, page: 1, pages: 1 };
  }
}

/**
 * Debounce wrapper for module table search
 * @param {Object} config - loadModuleTable config
 * @param {string} debounceKey - Unique key for this debounce timer
 * @param {number} delay - Debounce delay in ms (default 300)
 */
function debounceModuleTableSearch(config, debounceKey, delay = 300) {
  const timerKey = `_debounceTimer_${debounceKey}`;
  clearTimeout(window[timerKey]);
  window[timerKey] = setTimeout(() => loadModuleTable(config, 1), delay);
}

// ============================================================================
// Initialization on Page Load
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI components from helpers-ui.js
  if (typeof initToastContainer === 'function') {
    initToastContainer();
  }
  if (typeof initializeUiAnimations === 'function') {
    initializeUiAnimations();
  }

  // Initialize table styles from helpers-table.js
  if (typeof initializeTableStyles === 'function') {
    initializeTableStyles();
  }
});
