# P1.3: Integration Guide - Responsive Dashboard

## Quick Start

### 1. Add CSS to Your HTML
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Add responsive CSS -->
  <link rel="stylesheet" href="/admin/styles/responsive.css">
  
  <!-- Your other stylesheets -->
  <link rel="stylesheet" href="/admin/styles/your-custom-styles.css">
</head>
<body>
  <!-- Your HTML -->
  
  <!-- Initialize scripts -->
  <script type="module">
    import { initResponsiveNav } from '/admin/modules/responsive-nav.js';
    import { initializeUiAnimations } from '/admin/modules/helpers-ui.js';
    import { initializeTableStyles } from '/admin/modules/helpers-table.js';
    import { initializeFormStyles } from '/admin/modules/helpers-form.js';
    
    document.addEventListener('DOMContentLoaded', () => {
      initializeUiAnimations();
      initializeTableStyles();
      initializeFormStyles();
      initResponsiveNav();
      console.log('✅ Responsive dashboard initialized');
    });
  </script>
</body>
</html>
```

---

## HTML Structure Template

### Navigation with Hamburger Menu
```html
<header>
  <nav>
    <!-- Brand/Logo -->
    <div class="nav-brand">MANAWA</div>
    
    <!-- Hamburger button (mobile only) -->
    <button class="nav-toggle" aria-label="Toggle navigation">☰</button>
    
    <!-- Navigation menu -->
    <ul class="nav-menu">
      <li class="nav-item">
        <a href="#" class="nav-link active">Dashboard</a>
      </li>
      <li class="nav-item">
        <a href="#" class="nav-link">Users</a>
      </li>
      <li class="nav-item">
        <a href="#" class="nav-link">Reports</a>
      </li>
      <li class="nav-item">
        <a href="#" class="nav-link">Settings</a>
      </li>
    </ul>
  </nav>
</header>
```

### Main Layout
```html
<div class="main-layout">
  <!-- Optional: Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-item active">Dashboard</div>
    <div class="sidebar-item">Users</div>
    <div class="sidebar-item">Reports</div>
  </aside>
  
  <!-- Main content -->
  <main class="page-content">
    <div class="container">
      <!-- Your content here -->
    </div>
  </main>
</div>
```

### Cards
```html
<article class="card">
  <div class="card-header">
    <h2 class="card-title">Title</h2>
    <button class="btn btn-sm btn-secondary">Action</button>
  </div>
  <div class="card-body">
    <!-- Content -->
  </div>
  <div class="card-footer">
    <button class="btn btn-secondary">Cancel</button>
    <button class="btn btn-primary">Save</button>
  </div>
</article>
```

### Forms
```html
<form>
  <!-- Two-column on desktop, one on mobile -->
  <div class="form-row">
    <div class="form-group">
      <label for="name">Name</label>
      <input type="text" id="name" placeholder="Your name" required>
      <div class="form-hint">Required field</div>
    </div>
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" placeholder="your@email.com" required>
    </div>
  </div>
  
  <!-- Single column -->
  <div class="form-group">
    <label for="message">Message</label>
    <textarea id="message" placeholder="Your message" rows="4"></textarea>
  </div>
  
  <!-- Validation feedback -->
  <div class="form-group is-invalid">
    <label for="username">Username</label>
    <input type="text" id="username" placeholder="Username" required>
    <div class="form-error">Username already taken</div>
  </div>
  
  <!-- Submit buttons -->
  <div class="card-footer">
    <button type="button" class="btn btn-secondary">Cancel</button>
    <button type="submit" class="btn btn-primary">Submit</button>
  </div>
</form>
```

### Tables with Responsive Rendering
```html
<!-- Method 1: Let JavaScript render table -->
<div id="table-container"></div>

<script type="module">
import { renderTable } from '/admin/modules/helpers-table.js';

const data = [
  { id: 1, name: 'John', email: 'john@example.com', status: 'Active' },
  { id: 2, name: 'Jane', email: 'jane@example.com', status: 'Inactive' },
];

const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Status', renderer: (val) => `<span style="color: ${val === 'Active' ? 'green' : 'red'}">${val}</span>` },
];

const handlers = {
  onEdit: (row) => console.log('Edit:', row),
  onDelete: (row) => console.log('Delete:', row),
};

const container = document.getElementById('table-container');
const table = renderTable(data, columns, handlers, { responsive: true });
container.appendChild(table);
</script>

<!-- Method 2: Manual HTML table -->
<div class="table-wrapper">
  <table class="admin-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Email</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>John Doe</td>
        <td>john@example.com</td>
        <td>Active</td>
        <td class="action-cell">
          <button class="btn btn-sm btn-primary">Edit</button>
          <button class="btn btn-sm btn-danger">Delete</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### Grids
```html
<!-- 2-column grid (1 on mobile, 2 on desktop) -->
<div class="grid grid-2">
  <div class="card">Column 1</div>
  <div class="card">Column 2</div>
</div>

<!-- 3-column grid -->
<div class="grid grid-3">
  <div class="card">Column 1</div>
  <div class="card">Column 2</div>
  <div class="card">Column 3</div>
</div>

<!-- 4-column grid -->
<div class="grid grid-4">
  <div class="card">Column 1</div>
  <div class="card">Column 2</div>
  <div class="card">Column 3</div>
  <div class="card">Column 4</div>
</div>
```

### Modals
```html
<div id="myModal" class="modal">
  <div class="modal-content">
    <div class="modal-header">
      <h2 class="modal-title">Modal Title</h2>
      <button class="modal-close" onclick="closeModal('myModal')">×</button>
    </div>
    <div class="modal-body">
      <!-- Modal content -->
      <p>Your content here...</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal('myModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveModal('myModal')">Save</button>
    </div>
  </div>
</div>

<!-- Trigger button -->
<button class="btn btn-primary" onclick="openModal('myModal')">Open Modal</button>
```

---

## CSS Utilities Cheat Sheet

### Display
```html
<div class="d-none">Hidden</div>
<div class="d-block">Block element</div>
<div class="d-flex">Flex container</div>
```

### Flexbox
```html
<div class="d-flex flex-row gap-md">Row layout</div>
<div class="d-flex flex-column gap-lg">Column layout</div>
<div class="d-flex flex-wrap">Wrap items</div>
```

### Spacing
```html
<!-- Padding: p-0, p-1, p-2, p-3, p-4 -->
<div class="p-3">Padded content</div>

<!-- Margin: m-0, m-1, m-2, m-3, m-4 -->
<div class="m-2">Margined content</div>

<!-- Specific margins: mt, mb, ml, mr -->
<div class="mt-3 mb-4">Vertical margins</div>

<!-- Gaps in flex -->
<div class="d-flex gap-sm">Small gap</div>
<div class="d-flex gap-md">Medium gap</div>
<div class="d-flex gap-lg">Large gap</div>
```

### Text
```html
<p class="text-center">Centered text</p>
<p class="text-right">Right aligned</p>
<p class="text-muted">Gray text</p>
<p class="text-danger">Red text</p>
<p class="text-success">Green text</p>
<p class="text-primary">Blue text</p>
```

### Buttons
```html
<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-danger">Danger</button>
<button class="btn btn-sm">Small button</button>
<button class="btn btn-block">Full width</button>

<!-- Button groups -->
<div class="btn-group">
  <button class="btn btn-secondary">Button 1</button>
  <button class="btn btn-secondary">Button 2</button>
  <button class="btn btn-secondary">Button 3</button>
</div>
```

---

## JavaScript API

### Responsive Navigation
```javascript
import { 
  initResponsiveNav,
  toggleMobileNav,
  openMobileNav,
  closeMobileNav,
  isMobileNavOpen,
  isMobileView,
  isTabletView,
  isDesktopView,
  getCurrentBreakpoint,
  onBreakpoint,
  toggleSidebar,
  closeSidebar
} from '/admin/modules/responsive-nav.js';

// Initialize
initResponsiveNav();

// Check current view
if (isMobileView()) {
  console.log('Mobile view');
} else if (isDesktopView()) {
  console.log('Desktop view');
}

// Get current breakpoint
const bp = getCurrentBreakpoint(); // 'mobile' | 'tablet' | 'desktop'

// Run code at specific breakpoint
onBreakpoint('mobile', () => {
  console.log('Running on mobile');
});

// Control menu programmatically
openMobileNav();
closeMobileNav();
console.log(isMobileNavOpen()); // true/false

// Control sidebar
toggleSidebar();
closeSidebar();
```

### UI Helpers
```javascript
import {
  openModal,
  closeModal,
  showToast,
  escapeHtml,
  initializeUiAnimations
} from '/admin/modules/helpers-ui.js';

// Initialize animations
initializeUiAnimations();

// Modal management
openModal('myModal', { data: 'example' });
closeModal('myModal');

// Notifications
showToast('Success!', false);  // success
showToast('Error!', true);     // error
```

### Table Helpers
```javascript
import {
  renderTable,
  renderCardLayout,
  initializeTableStyles
} from '/admin/modules/helpers-table.js';

// Initialize styles
initializeTableStyles();

// Render table
const table = renderTable(
  data,           // Array of objects
  columns,        // Array of column definitions
  handlers,       // Event handlers (onEdit, onDelete, onAction)
  {
    responsive: true,
    cardLayout: false  // true for mobile card view
  }
);

// Or render card layout directly
const cards = renderCardLayout(data, columns, handlers);
```

### Form Helpers
```javascript
import {
  validateEmail,
  validatePhoneNumber,
  validateUrl,
  validateNumberRange,
  validateRequired,
  debounce,
  throttle,
  initializeFormStyles
} from '/admin/modules/helpers-form.js';

// Initialize styles
initializeFormStyles();

// Validation functions
if (validateEmail('test@example.com')) {
  console.log('Valid email');
}

// Rate limiting
const debouncedSearch = debounce((query) => {
  console.log('Searching:', query);
}, 300);

const throttledResize = throttle(() => {
  console.log('Window resized');
}, 500);
```

---

## Events

### Mobile Navigation Events
```javascript
// When mobile nav opens
document.addEventListener('mobileNavOpen', () => {
  console.log('Navigation opened');
});

// When mobile nav closes
document.addEventListener('mobileNavClose', () => {
  console.log('Navigation closed');
});

// When orientation changes
document.addEventListener('orientationChange', (e) => {
  console.log('Orientation:', e.detail.orientation); // 'portrait' | 'landscape'
});
```

### Modal Events
```javascript
const modal = document.getElementById('myModal');

modal.addEventListener('modalOpen', (e) => {
  console.log('Modal opened:', e.detail);
});

modal.addEventListener('modalClose', (e) => {
  console.log('Modal closed:', e.detail);
});
```

### Table Events
```javascript
const table = renderTable(...);

table.addEventListener('sort', (e) => {
  console.log('Sort column:', e.detail.key);
});
```

---

## Responsive Breakpoints Reference

### How Responsive Works

The system uses a mobile-first approach:

1. **Default styles** (mobile - 480px and below)
2. **@media (min-width: 481px)** - Tablet enhancements
3. **@media (min-width: 1025px)** - Desktop enhancements

### CSS Media Queries
```css
/* Mobile (default) */
.grid-2 { grid-template-columns: 1fr; }

/* Tablet and up */
@media (min-width: 769px) {
  .grid-2 { grid-template-columns: 1fr 1fr; }
}

/* Desktop and up */
@media (min-width: 1025px) {
  .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
}
```

### JavaScript Media Queries
```javascript
// Check current breakpoint
const isMobile = window.matchMedia('(max-width: 768px)').matches;
const isTablet = window.matchMedia('(min-width: 769px) and (max-width: 1024px)').matches;
const isDesktop = window.matchMedia('(min-width: 1025px)').matches;

// Listen for changes
window.matchMedia('(max-width: 768px)').addEventListener('change', (e) => {
  if (e.matches) console.log('Now mobile');
  else console.log('No longer mobile');
});
```

---

## Common Patterns

### Mobile-First Grid
```html
<!-- Automatically adjusts: 1 col mobile → 2 cols tablet → 3 cols desktop -->
<div class="grid grid-3">
  <div class="card">Item 1</div>
  <div class="card">Item 2</div>
  <div class="card">Item 3</div>
</div>
```

### Responsive Form
```html
<!-- 2 columns desktop, 1 mobile -->
<form>
  <div class="form-row">
    <div class="form-group">
      <label>First Name</label>
      <input type="text" required>
    </div>
    <div class="form-group">
      <label>Last Name</label>
      <input type="text" required>
    </div>
  </div>
  
  <div class="form-group">
    <label>Message</label>
    <textarea required></textarea>
  </div>
  
  <div class="card-footer">
    <button type="button" class="btn btn-secondary">Cancel</button>
    <button type="submit" class="btn btn-primary">Submit</button>
  </div>
</form>
```

### Responsive Navigation
```html
<!-- Hamburger menu appears automatically on mobile -->
<header>
  <nav>
    <div class="nav-brand">Logo</div>
    <button class="nav-toggle">☰</button>  <!-- Auto-hidden on desktop -->
    <ul class="nav-menu">
      <!-- Auto-hidden on mobile, shown on desktop -->
    </ul>
  </nav>
</header>
```

---

## Troubleshooting

### Menu not appearing
- Check that CSS is loaded: `<link rel="stylesheet" href="/admin/styles/responsive.css">`
- Verify responsive-nav.js is initialized: `initResponsiveNav()`
- Check browser console for errors

### Forms too small on mobile
- Ensure input font-size is 16px (prevents iOS zoom)
- Check that inputs have `min-height: 44px`
- Use `.form-row` for responsive layout

### Table overflow
- Wrap table in `.table-wrapper`
- Or use card layout: `renderTable(..., { cardLayout: true })`

### Mobile menu not closing
- Verify `closeMobileNav()` is called
- Check that backdrop close is working
- Ensure ESC key handler is set up

---

## Testing Responsive

### Manual Testing
1. **Open browser DevTools** (F12)
2. **Toggle Device Toolbar** (Ctrl+Shift+M)
3. **Test different devices:**
   - iPhone 12 (390px)
   - iPad (768px)
   - Desktop (1024px+)

### Real Device Testing
1. Get local IP: `ipconfig getifaddr en0` (Mac) or use your IP
2. Open in phone browser: `http://YOUR_IP:3000/admin/`
3. Test touch interactions, scrolling, buttons

### Automated Testing
```javascript
// Quick test
console.log(isMobileView());      // true if ≤768px
console.log(getCurrentBreakpoint()); // 'mobile' | 'tablet' | 'desktop'
```

---

## Production Checklist

- [ ] CSS loaded without errors
- [ ] JavaScript modules initialized
- [ ] Navigation works on mobile
- [ ] Forms touch-friendly
- [ ] Tables responsive
- [ ] Modals work on all sizes
- [ ] No console errors
- [ ] Performance good (no lag)
- [ ] Tested on real devices
- [ ] Cross-browser compatible

---

Ready to go! See **RESPONSIVE_GUIDE.md** for more details.
