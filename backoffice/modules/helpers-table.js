/**
 * Table Helpers Module
 * Generic table rendering and manipulation utilities
 * Part of MANAWA Admin Helpers Library
 */

// ============================================================================
// Table Rendering
// ============================================================================

/**
 * Render HTML table from data array
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<Object>} columns - Column definitions
 *   [{ key: 'id', label: 'ID', sortable: true, renderer: fn },...]
 * @param {Object} handlers - Event handlers { onEdit, onDelete, onAction }
 * @param {Object} options - Options { responsive: true, cardLayout: false }
 * @returns {HTMLTableElement|HTMLDivElement} - Built table element or card container
 */
function renderTable(data = [], columns = [], handlers = {}, options = {}) {
  const isResponsive = options.responsive !== false;
  const useCardLayout = options.cardLayout || false;

  // On mobile, optionally use card layout instead of table
  if (isResponsive && useCardLayout && window.innerWidth <= 768) {
    return renderCardLayout(data, columns, handlers);
  }

  const table = document.createElement('table');
  table.className = 'admin-table';

  // Create thead
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col.label || col.key;

    if (col.sortable) {
      th.className = 'sortable';
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const event = new CustomEvent('sort', { detail: { key: col.key } });
        table.dispatchEvent(event);
      });
    }

    headerRow.appendChild(th);
  });

  // Add actions column header if handlers exist
  if (Object.keys(handlers).length > 0) {
    const th = document.createElement('th');
    th.textContent = 'Actions';
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create tbody
  const tbody = document.createElement('tbody');

  if (data.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length + (Object.keys(handlers).length > 0 ? 1 : 0);
    td.textContent = 'No data available';
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = '#666';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    data.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.rowIndex = rowIndex;

      // Render columns
      columns.forEach((col) => {
        const td = document.createElement('td');
        const value = row[col.key];

        if (col.renderer && typeof col.renderer === 'function') {
          td.innerHTML = col.renderer(value, row);
        } else {
          td.textContent = value !== undefined && value !== null ? String(value) : '-';
        }

        tr.appendChild(td);
      });

      // Render actions
      if (Object.keys(handlers).length > 0) {
        const td = document.createElement('td');
        td.className = 'action-cell';

        if (handlers.onEdit) {
          const editBtn = document.createElement('button');
          editBtn.className = 'btn btn-sm btn-primary';
          editBtn.textContent = 'Edit';
          editBtn.addEventListener('click', () => handlers.onEdit(row, rowIndex));
          td.appendChild(editBtn);
        }

        if (handlers.onDelete) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn btn-sm btn-danger';
          deleteBtn.textContent = 'Delete';
          deleteBtn.addEventListener('click', () => {
            if (confirm('Are you sure?')) {
              handlers.onDelete(row, rowIndex);
            }
          });
          td.appendChild(deleteBtn);
        }

        if (handlers.onAction) {
          Object.entries(handlers.onAction).forEach(([actionName, handler]) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-secondary';
            btn.textContent = actionName;
            btn.addEventListener('click', () => handler(row, rowIndex));
            td.appendChild(btn);
          });
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  return table;
}

// ============================================================================
// Card Layout (Mobile Alternative to Tables)
// ============================================================================

/**
 * Render card layout for mobile (alternative to table)
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<Object>} columns - Column definitions
 * @param {Object} handlers - Event handlers
 * @returns {HTMLDivElement} - Card container
 */
function renderCardLayout(data = [], columns = [], handlers = {}) {
  const container = document.createElement('div');
  container.className = 'card-layout';

  if (data.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'card-empty';
    emptyMsg.textContent = 'No data available';
    container.appendChild(emptyMsg);
    return container;
  }

  data.forEach((row, rowIndex) => {
    const card = document.createElement('div');
    card.className = 'card-item';
    card.dataset.rowIndex = rowIndex;

    // Add fields to card
    columns.forEach((col) => {
      const field = document.createElement('div');
      field.className = 'card-field';

      const label = document.createElement('div');
      label.className = 'card-label';
      label.textContent = col.label || col.key;

      const value = document.createElement('div');
      value.className = 'card-value';

      const cellValue = row[col.key];
      if (col.renderer && typeof col.renderer === 'function') {
        value.innerHTML = col.renderer(cellValue, row);
      } else {
        value.textContent = cellValue !== undefined && cellValue !== null ? String(cellValue) : '-';
      }

      field.appendChild(label);
      field.appendChild(value);
      card.appendChild(field);
    });

    // Add actions
    if (Object.keys(handlers).length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'card-actions';

      if (handlers.onEdit) {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm btn-primary';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => handlers.onEdit(row, rowIndex));
        actionsDiv.appendChild(editBtn);
      }

      if (handlers.onDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          if (confirm('Are you sure?')) {
            handlers.onDelete(row, rowIndex);
          }
        });
        actionsDiv.appendChild(deleteBtn);
      }

      if (handlers.onAction) {
        Object.entries(handlers.onAction).forEach(([actionName, handler]) => {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-secondary';
          btn.textContent = actionName;
          btn.addEventListener('click', () => handler(row, rowIndex));
          actionsDiv.appendChild(btn);
        });
      }

      card.appendChild(actionsDiv);
    }

    container.appendChild(card);
  });

  return container;
}

// ============================================================================
// Table CSS Styles - RESPONSIVE
// ============================================================================

/**
 * Initialize table styles (call on page load)
 */
function initializeTableStyles() {
  if (document.getElementById('helpers-table-styles')) return;

  const style = document.createElement('style');
  style.id = 'helpers-table-styles';
  style.textContent = `
    /* ═══════════════════════════════════════════════════════════════ */
    /* TABLE STYLES - DESKTOP                                          */
    /* ═══════════════════════════════════════════════════════════════ */
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 20px 0;
      border-radius: 8px;
      border: 1px solid #dee2e6;
    }

    .admin-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
    }

    .admin-table thead {
      background-color: #f8f9fa;
      position: sticky;
      top: 0;
    }

    .admin-table th {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 2px solid #dee2e6;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
    }

    .admin-table th.sortable {
      cursor: pointer;
      user-select: none;
    }

    .admin-table th.sortable:hover {
      background-color: #e9ecef;
    }

    .admin-table td {
      padding: 12px 14px;
      border-bottom: 1px solid #dee2e6;
      font-size: 14px;
    }

    .admin-table tr:hover {
      background-color: #f8f9fa;
    }

    .action-cell {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /* CARD LAYOUT - MOBILE (Alternative to table)                     */
    /* ═══════════════════════════════════════════════════════════════ */
    .card-layout {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 20px 0;
    }

    .card-empty {
      text-align: center;
      padding: 40px 20px;
      color: #6c757d;
      font-size: 14px;
    }

    .card-item {
      background: white;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .card-label {
      font-size: 12px;
      font-weight: 600;
      color: #6c757d;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card-value {
      font-size: 14px;
      color: #212529;
      word-break: break-word;
    }

    .card-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #dee2e6;
    }

    .card-actions .btn {
      width: 100%;
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /* MOBILE RESPONSIVE - Tables                                      */
    /* ═══════════════════════════════════════════════════════════════ */
    @media (max-width: 768px) {
      .table-wrapper {
        margin: 16px -12px;
        border-radius: 0;
        border-left: none;
        border-right: none;
      }

      .admin-table {
        min-width: 600px;
      }

      .admin-table th {
        padding: 10px 8px;
        font-size: 12px;
      }

      .admin-table td {
        padding: 10px 8px;
        font-size: 13px;
      }

      .action-cell {
        gap: 4px;
      }

      .action-cell .btn-sm {
        padding: 4px 6px;
        font-size: 11px;
      }
    }

    /* ═══════════════════════════════════════════════════════════════ */
    /* TABLET RESPONSIVE - Tables                                      */
    /* ═══════════════════════════════════════════════════════════════ */
    @media (max-width: 1024px) and (min-width: 769px) {
      .admin-table th {
        padding: 10px 10px;
        font-size: 13px;
      }

      .admin-table td {
        padding: 10px 10px;
        font-size: 13px;
      }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// Module Exports
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderTable,
    renderCardLayout,
    initializeTableStyles,
  };
}
