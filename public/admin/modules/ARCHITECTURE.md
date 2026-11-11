# Admin Helpers - Architecture Documentation

## Overview

Refactored helpers library split into 4 focused modules + 1 barrel coordinator.

```
┌─────────────────────────────────────────────────────────────┐
│                   APP / ADMIN MODULES                       │
│          (users.js, companies.js, products.js, etc)         │
└────────────────────┬────────────────────────────────────────┘
                     │ imports
                     ▼
┌──────────────────────────────────────────────────────────────┐
│              helpers.js (BARREL COORDINATOR)                │
│  - loadModuleTable() - DRY table loading                    │
│  - debounceModuleTableSearch()                             │
│  - Initialize animations on DOMContentLoaded                │
│                    EXPORTS TO:                              │
│  - All sub-module functions (forwarded)                    │
│  - Extra utilities (loadModuleTable, debounce search)      │
└──┬──────────────────┬──────────────────┬──────────────────┬─┘
   │                  │                  │                  │
   ▼                  ▼                  ▼                  ▼
┌─────────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐
│helpers-ui.js│ │helpers-   │ │helpers-form. │ │helpers-   │
│  (297 L)    │ │ table.js  │ │ js (117 L)   │ │data.js    │
│             │ │ (196 L)   │ │              │ │ (277 L)   │
│ MODAL/TOAST │ │ TABLE RDR │ │ VALIDATION   │ │ API/CSRF  │
│ SAFE HTML   │ │ STYLES    │ │ DEBOUNCE     │ │ FORMATTING│
└─────────────┘ └───────────┘ └──────────────┘ └───────────┘
```

## Load Sequence

### Step 1: Load Sub-Modules (Parallel Safe)
```javascript
// order doesn't matter - no inter-module dependencies
<script src="modules/helpers-ui.js"></script>
<script src="modules/helpers-table.js"></script>
<script src="modules/helpers-form.js"></script>
<script src="modules/helpers-data.js"></script>
```

### Step 2: Load Barrel
```javascript
// depends on all sub-modules being loaded
// registers DOMContentLoaded listener
<script src="helpers.js"></script>
```

### Step 3: Use Helpers
```javascript
// all functions available globally
showToast("Success!");
const result = await apiCall("/api/endpoint");
const formatted = formatCurrency(100);
```

---

## Module Responsibilities

### helpers-ui.js - User Interface
**Responsibility**: Modal dialogs, notifications, DOM safety

**Functions**:
- `openModal(modalId, data)` - Show modal
- `closeModal(modalId, result)` - Hide modal
- `setupModalBackdropClose(modalId)` - Click-outside close
- `initToastContainer()` - Init notification system
- `showToast(message, isError, duration)` - Show notification
- `escapeHtml(text)` - Sanitize HTML
- `createSafeElement(tag, text, attrs)` - Create safe DOM elements
- `initializeUiAnimations()` - Register CSS keyframes

**Dependencies**: None (self-contained)

**Used By**: All admin modules for notifications and modals

---

### helpers-table.js - Table Rendering
**Responsibility**: Generic HTML table creation with interactive features

**Functions**:
- `renderTable(data, columns, handlers)` - Build HTML table
- `initializeTableStyles()` - Register table CSS

**Dependencies**: None (self-contained)

**Used By**: Admin modules that need to display data tables

**Features**:
- Sortable columns (emits custom 'sort' event)
- Custom column renderers
- Actions buttons (Edit, Delete, Custom)
- Empty state
- Hover styles

---

### helpers-form.js - Form Validation & Rate Limiting
**Responsibility**: Input validation, debounce/throttle utilities

**Functions**:
- `validateEmail(email)` - RFC-like email regex
- `validatePhoneNumber(phone)` - International format check
- `validateUrl(url)` - URL.constructor validation
- `validateNumberRange(value, min, max)` - Range check
- `validateRequired(value)` - Non-empty check
- `debounce(fn, delay)` - Delay execution
- `throttle(fn, interval)` - Limit frequency

**Dependencies**: None (self-contained)

**Used By**: Form handlers, search inputs, event listeners

**Note**: helpers-form.js is the SMALLEST module (117L) - very focused

---

### helpers-data.js - Data Operations
**Responsibility**: API communication, CSRF protection, data formatting

**Functions**:
- `apiCall(endpoint, options)` - Fetch with CSRF & retry logic
- `getCsrfToken()` - Extract token from meta/cookie/input
- `verifyCsrfToken()` - Check token exists
- `formatDate(date, format)` - Intl.toLocaleDateString
- `formatRelativeTime(date)` - Relative time ("2 hours ago")
- `formatCurrency(amount, currency, decimals)` - Intl.NumberFormat
- `formatNumber(num, decimals)` - Compact format (1.5K, 3.2M)

**Dependencies**: None (self-contained)

**Used By**: API calls, display formatting

**Security**: Auto-injects CSRF tokens, handles retry on 5xx

---

### helpers.js - Barrel Coordinator
**Responsibility**: Central orchestration, DRY table loading, initialization

**Functions**:
- `loadModuleTable(config, page)` - Generic paginated table loader
- `debounceModuleTableSearch(config, key, delay)` - Search debounce

**Exports**:
- All sub-module functions (forwarded)
- Plus the 2 coordinator functions

**Dependencies**: All 4 sub-modules (must load after them)

**Initialization**:
- DOMContentLoaded listener:
  - Calls `initToastContainer()`
  - Calls `initializeUiAnimations()`
  - Calls `initializeTableStyles()`

**Usage Pattern**:
```javascript
// ELIMINATES CODE REPETITION IN 20+ ADMIN MODULES
// Instead of each module copy-pasting:
//   - Fetch with pagination
//   - Render rows
//   - Handle pagination buttons
//   - Handle search
// They now just call:

export async function loadUsers(page = 1) {
  return loadModuleTable({
    endpoint: '/api/users?page={page}&limit={limit}',
    selector: { tbody: 'users-tbody', pagination: 'users-pag' },
    columns: [...],
    searchInput: 'search'
  }, page);
}
```

---

## Inter-Module Communication

### No Direct Dependencies
Each module is self-contained. No module imports from another.

### Indirect via helpers.js
The barrel file:
1. Expects all sub-modules to be loaded
2. Calls their initialization functions
3. Uses `apiCall()` and `escapeHtml()` in `loadModuleTable()`

### Global Functions
All functions are global (attached to `window`):
```javascript
window.showToast
window.apiCall
window.validateEmail
window.renderTable
window.loadModuleTable
// ... etc
```

---

## Maintainability

### Single Responsibility Principle
- helpers-ui.js: All modal/toast/safe-HTML concerns
- helpers-table.js: All table rendering concerns
- helpers-form.js: All validation/rate-limit concerns
- helpers-data.js: All API/CSRF/formatting concerns

### Easy to Locate Functions
Need to find how search is debounced? Check helpers-form.js
Need to add a new toast style? Check helpers-ui.js
Need to change API error handling? Check helpers-data.js

### Easy to Test
Each module can be tested in isolation with no dependencies.

### File Size Management
- All files < 300 lines
- Respects ECC 800L ceiling by design
- Future expansion: can extract sub-categories if any module nears 300L

---

## Adding New Helpers

### If it's UI-related (modal, toast, safe HTML)
Add to: `helpers-ui.js`
Max current: 297L, so <50L of new code fits easily

### If it's table/rendering related
Add to: `helpers-table.js`
Max current: 196L, so plenty of room

### If it's validation/debounce/throttle
Add to: `helpers-form.js`
Max current: 117L (COMPACT - room for more)

### If it's API/CSRF/formatting
Add to: `helpers-data.js`
Max current: 277L, so ~50L of new code fits

### If it's a cross-cutting coordinator utility
Add to: `helpers.js`
Max current: 269L, so some room

### If adding a whole new category
Create: `modules/helpers-CATEGORY.js`
Add to barrel imports in `helpers.js`
Document in this file

---

## Performance Considerations

### Bundle Size
Current total: 1156 lines across 5 files
Minified (est): ~25-30KB total

### Lazy Loading (Future Optimization)
If needed, helpers could be split into:
- helpers-core.js (essentials: apiCall, showToast)
- helpers-ui.js (modals/toasts)
- helpers-form.js (validation)
- helpers-table.js (table rendering)
- helpers-data.js (formatting)

Then load only what's needed per admin section.

### Runtime Optimization
- Debounce/throttle prevent event spam
- apiCall includes 30s timeout
- formatters use native Intl API (fast)
- Modal/toast setup is lazy (first use)

---

## Breaking Changes Prevention

### v2.0 Compatibility
All function signatures remain identical.
All functions available in same namespace.
No migrations needed for existing code.

The refactoring is **100% internal** - purely organizational.

---

## Summary

| Aspect | Details |
|--------|---------|
| **Architecture** | 4 focused modules + 1 barrel coordinator |
| **File Sizes** | 117L - 297L (all respecting ceiling) |
| **Dependencies** | None between modules |
| **Load Order** | Sub-modules first, barrel last |
| **Global Access** | All functions on `window` |
| **Maintenance** | Easy to locate & update functions |
| **Testing** | Modules testable in isolation |
| **Breaking Changes** | None - 100% compatible |

End of Architecture Doc
