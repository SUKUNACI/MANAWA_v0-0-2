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
 * @returns {HTMLTableElement} - Built table element
 */
function renderTable(data = [], columns = [], handlers = {}) {
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
// Table CSS Styles
// ============================================================================

/**
 * Initialize table styles (call on page load)
 */
function initializeTableStyles() {
  if (document.getElementById('helpers-table-styles')) return;

  const style = document.createElement('style');
  style.id = 'helpers-table-styles';
  style.textContent = `
    .admin-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }

    .admin-table thead {
      background-color: #f8f9fa;
    }

    .admin-table th {
      padding: 12px;
      text-align: left;
      border-bottom: 2px solid #dee2e6;
      font-weight: 600;
    }

    .admin-table th.sortable {
      cursor: pointer;
      user-select: none;
    }

    .admin-table th.sortable:hover {
      background-color: #e9ecef;
    }

    .admin-table td {
      padding: 12px;
      border-bottom: 1px solid #dee2e6;
    }

    .admin-table tr:hover {
      background-color: #f8f9fa;
    }

    .action-cell {
      display: flex;
      gap: 6px;
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
    initializeTableStyles,
  };
}
