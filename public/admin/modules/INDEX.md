# Admin Helpers - Module Index

## Rapid Reference

### UI Module (helpers-ui.js)
**Purpose**: Modal dialogs, toast notifications, safe HTML rendering

| Function | Params | Returns | Usage |
|----------|--------|---------|-------|
| `openModal()` | modalId, data? | void | Show modal dialog |
| `closeModal()` | modalId, result? | void | Hide modal dialog |
| `setupModalBackdropClose()` | modalId | void | Enable click-outside close |
| `initToastContainer()` | - | void | Initialize toast system |
| `showToast()` | message, isError?, duration? | HTMLElement | Display notification |
| `escapeHtml()` | text | string | Sanitize HTML text |
| `createSafeElement()` | tagName, textContent?, attributes? | HTMLElement | Create safe DOM element |
| `initializeUiAnimations()` | - | void | Register CSS animations |

**Lines**: 297

---

### Table Module (helpers-table.js)
**Purpose**: Generic HTML table rendering with sorting and actions

| Function | Params | Returns | Usage |
|----------|--------|---------|-------|
| `renderTable()` | data, columns, handlers? | HTMLTableElement | Build table from data |
| `initializeTableStyles()` | - | void | Register table CSS |

**Lines**: 196

**Example**:
```javascript
const table = renderTable(users, [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email' }
], {
  onEdit: (row) => editUser(row),
  onDelete: (row) => deleteUser(row)
});
document.getElementById('container').appendChild(table);
```

---

### Form Module (helpers-form.js)
**Purpose**: Input validation and rate-limiting utilities

| Function | Params | Returns | Usage |
|----------|--------|---------|-------|
| `validateEmail()` | email | boolean | Check email format |
| `validatePhoneNumber()` | phone | boolean | Check phone format |
| `validateUrl()` | url | boolean | Check URL format |
| `validateNumberRange()` | value, min, max | boolean | Check if in range |
| `validateRequired()` | value | boolean | Check not empty |
| `debounce()` | fn, delay? | Function | Rate-limit function calls |
| `throttle()` | fn, interval? | Function | Limit execution frequency |

**Lines**: 117

**Example**:
```javascript
// Search with debounce
const debouncedSearch = debounce((query) => {
  fetch(`/api/search?q=${query}`);
}, 300);

// Throttle scroll handler
const throttledScroll = throttle(() => {
  updateUI();
}, 100);
```

---

### Data Module (helpers-data.js)
**Purpose**: API calls, CSRF protection, date/currency formatting

| Function | Params | Returns | Usage |
|----------|--------|---------|-------|
| `apiCall()` | endpoint, options? | Promise | Fetch with CSRF & retry |
| `getCsrfToken()` | - | string | Extract CSRF token |
| `verifyCsrfToken()` | - | boolean | Check token exists |
| `formatDate()` | date, format? | string | Format date (short/long/full) |
| `formatRelativeTime()` | date | string | Format as "2 hours ago" |
| `formatCurrency()` | amount, currency?, decimals? | string | Format as $1,234.56 |
| `formatNumber()` | num, decimals? | string | Format as 1.2K, 3.4M, etc |

**Lines**: 277

**Example**:
```javascript
// API call
const result = await apiCall('/api/users', {
  method: 'POST',
  body: { name: 'John' }
});

// Format data
console.log(formatCurrency(1234.56));           // "$1,234.56"
console.log(formatNumber(1500000));             // "1.5M"
console.log(formatDate(new Date(), 'long'));   // "November 10, 2026"
```

---

### Barrel Module (helpers.js)
**Purpose**: Central orchestration, DRY table loader, initialization

| Function | Params | Returns | Usage |
|----------|--------|---------|-------|
| `loadModuleTable()` | config, page? | Promise | Load & render paginated table |
| `debounceModuleTableSearch()` | config, key, delay? | void | Debounce search reload |

**Lines**: 269

**Example**:
```javascript
// Load table with pagination & search
export async function loadUsers(page = 1) {
  return loadModuleTable({
    endpoint: '/api/users?page={page}&limit={limit}',
    selector: { tbody: 'tbody', empty: 'empty', pagination: 'pag' },
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' }
    ],
    onRowClick: (row) => alert(`Selected ${row.name}`),
    searchInput: 'search-input'
  }, page);
}

// In HTML: <input id="search-input" oninput="debounceModuleTableSearch(...)" />
```

---

## Load Order (HTML)

```html
<!-- 1. Load sub-modules (order doesn't matter) -->
<script src="/admin/modules/helpers-ui.js"></script>
<script src="/admin/modules/helpers-table.js"></script>
<script src="/admin/modules/helpers-form.js"></script>
<script src="/admin/modules/helpers-data.js"></script>

<!-- 2. Load barrel (depends on sub-modules) -->
<script src="/admin/helpers.js"></script>

<!-- 3. Your application code can now use all helpers -->
<script src="/admin/app.js"></script>
```

---

## Statistics

| Module | Lines | Functions | Responsibility |
|--------|-------|-----------|-----------------|
| helpers-ui.js | 297 | 8 | Modals, Toasts, Safe HTML |
| helpers-table.js | 196 | 2 | Table Rendering |
| helpers-form.js | 117 | 7 | Validation, Rate-limiting |
| helpers-data.js | 277 | 7 | API, CSRF, Formatting |
| **helpers.js** | **269** | **2+init** | Orchestration, DRY Helpers |
| **TOTAL** | **1156** | **26+** | - |

All modules respect 800L ECC ceiling. No module exceeds 297 lines.

---

## Migration Guide (v1.0 -> v2.0)

**No breaking changes!** All functions available in same namespaces.

Old imports still work:
```javascript
// These all still work after refactoring
showToast("Hello");
apiCall("/api/endpoint");
formatCurrency(100);
validateEmail("test@example.com");
renderTable(data, cols);
debounce(fn, 300);
// ... etc
```

The refactoring is purely internal reorganization for maintainability.

---

## Security Notes

- **XSS Protection**: `escapeHtml()` and `createSafeElement()` sanitize inputs
- **CSRF Protection**: `apiCall()` automatically attaches CSRF tokens
- **Validation**: All validators use strict regex/type checking
- **Error Handling**: All async functions handle errors gracefully

---

## Performance Notes

- **Debounce/Throttle**: Use for search, scroll, resize handlers
- **apiCall()**: Includes automatic retry for 5xx errors, 30s timeout
- **loadModuleTable()**: Supports multiple response formats, flexible filtering

---

End of Index
