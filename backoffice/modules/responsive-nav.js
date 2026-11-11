/**
 * Responsive Navigation Module
 * Handles hamburger menu, mobile navigation, and responsive layout
 * Part of MANAWA Admin Responsive System
 */

// ============================================================================
// Mobile Navigation State
// ============================================================================

let mobileNavOpen = false;

/**
 * Initialize responsive navigation
 * Sets up hamburger menu and mobile nav behavior
 */
export function initResponsiveNav() {
  setupHamburgerMenu();
  setupMobileNavToggle();
  setupResponsiveBreakpoints();
  setupTouchOptimizations();
}

// ============================================================================
// Hamburger Menu
// ============================================================================

/**
 * Setup hamburger menu toggle button
 */
function setupHamburgerMenu() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (!navToggle || !navMenu) {
    console.warn('Navigation elements not found for hamburger menu');
    return;
  }

  navToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMobileNav();
  });

  // Close menu when clicking on nav links
  const navLinks = navMenu.querySelectorAll('.nav-link');
  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileNav();
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (mobileNavOpen && !navToggle.contains(e.target) && !navMenu.contains(e.target)) {
      closeMobileNav();
    }
  });

  // Close menu on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNavOpen) {
      closeMobileNav();
    }
  });
}

/**
 * Toggle mobile navigation menu
 */
function toggleMobileNav() {
  if (mobileNavOpen) {
    closeMobileNav();
  } else {
    openMobileNav();
  }
}

/**
 * Open mobile navigation menu
 */
function openMobileNav() {
  const navMenu = document.querySelector('.nav-menu');
  if (!navMenu) return;

  navMenu.classList.add('show');
  mobileNavOpen = true;

  // Prevent body scroll when menu is open
  document.body.style.overflow = 'hidden';

  // Dispatch custom event
  const event = new CustomEvent('mobileNavOpen');
  document.dispatchEvent(event);
}

/**
 * Close mobile navigation menu
 */
function closeMobileNav() {
  const navMenu = document.querySelector('.nav-menu');
  if (!navMenu) return;

  navMenu.classList.remove('show');
  mobileNavOpen = false;

  // Restore body scroll
  document.body.style.overflow = '';

  // Dispatch custom event
  const event = new CustomEvent('mobileNavClose');
  document.dispatchEvent(event);
}

/**
 * Check if mobile nav is currently open
 */
export function isMobileNavOpen() {
  return mobileNavOpen;
}

// ============================================================================
// Mobile Navigation Accessibility
// ============================================================================

/**
 * Setup mobile nav toggle for keyboard accessibility
 */
function setupMobileNavToggle() {
  const navToggle = document.querySelector('.nav-toggle');
  if (!navToggle) return;

  // Add aria attributes
  navToggle.setAttribute('aria-label', 'Toggle navigation menu');
  navToggle.setAttribute('aria-expanded', 'false');

  // Update aria-expanded when nav state changes
  document.addEventListener('mobileNavOpen', () => {
    navToggle.setAttribute('aria-expanded', 'true');
  });

  document.addEventListener('mobileNavClose', () => {
    navToggle.setAttribute('aria-expanded', 'false');
  });
}

// ============================================================================
// Responsive Breakpoint Management
// ============================================================================

/**
 * Setup responsive behavior for different breakpoints
 */
function setupResponsiveBreakpoints() {
  // Handle window resize to auto-close mobile nav on larger screens
  const mediaQueryDesktop = window.matchMedia('(min-width: 1025px)');

  function handleDesktopChange(e) {
    if (e.matches) {
      // Desktop view - close mobile nav if open
      if (mobileNavOpen) {
        closeMobileNav();
      }
    }
  }

  // Listen for media query changes (modern browsers)
  if (mediaQueryDesktop.addEventListener) {
    mediaQueryDesktop.addEventListener('change', handleDesktopChange);
  } else if (mediaQueryDesktop.addListener) {
    // Fallback for older browsers
    mediaQueryDesktop.addListener(handleDesktopChange);
  }
}

// ============================================================================
// Touch Optimizations
// ============================================================================

/**
 * Setup touch-friendly optimizations
 */
function setupTouchOptimizations() {
  // Enable smooth scrolling on mobile
  if ('scrollBehavior' in document.documentElement.style === false) {
    // Polyfill for smooth scroll if not supported
    setupSmoothScroll();
  }

  // Optimize tap targets (minimum 44x44px)
  setupTapTargetOptimizations();

  // Handle orientation changes
  setupOrientationHandling();
}

/**
 * Polyfill smooth scroll for older browsers
 */
function setupSmoothScroll() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  });
}

/**
 * Ensure all interactive elements have minimum 44x44px tap target
 */
function setupTapTargetOptimizations() {
  const interactiveSelectors = [
    'button',
    'a',
    'input[type="checkbox"]',
    'input[type="radio"]',
    '.btn',
    '[role="button"]',
  ];

  interactiveSelectors.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);

      if (size < 44 && size > 0) {
        el.style.minHeight = '44px';
        el.style.minWidth = '44px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
      }
    });
  });
}

/**
 * Handle device orientation changes
 */
function setupOrientationHandling() {
  const handleOrientationChange = () => {
    // Close mobile nav on orientation change
    if (mobileNavOpen) {
      closeMobileNav();
    }

    // Dispatch custom event for other components
    const event = new CustomEvent('orientationChange', {
      detail: {
        orientation: window.innerHeight > window.innerWidth ? 'portrait' : 'landscape',
      },
    });
    document.dispatchEvent(event);
  };

  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);
}

// ============================================================================
// Sidebar Management
// ============================================================================

/**
 * Toggle sidebar visibility on mobile
 */
export function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('show');
}

/**
 * Close sidebar
 */
export function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebar.classList.remove('show');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if current view is mobile
 */
export function isMobileView() {
  return window.innerWidth <= 768;
}

/**
 * Check if current view is tablet
 */
export function isTabletView() {
  return window.innerWidth > 768 && window.innerWidth <= 1024;
}

/**
 * Check if current view is desktop
 */
export function isDesktopView() {
  return window.innerWidth > 1024;
}

/**
 * Get current breakpoint name
 */
export function getCurrentBreakpoint() {
  if (isMobileView()) return 'mobile';
  if (isTabletView()) return 'tablet';
  if (isDesktopView()) return 'desktop';
  return 'unknown';
}

/**
 * Execute function at specific breakpoint
 */
export function onBreakpoint(breakpoint, callback) {
  const mediaQueries = {
    mobile: '(max-width: 768px)',
    tablet: '(min-width: 769px) and (max-width: 1024px)',
    desktop: '(min-width: 1025px)',
  };

  const query = window.matchMedia(mediaQueries[breakpoint]);

  const handler = (e) => {
    if (e.matches) {
      callback();
    }
  };

  if (query.addEventListener) {
    query.addEventListener('change', handler);
  } else if (query.addListener) {
    query.addListener(handler);
  }

  // Run immediately if currently at breakpoint
  if (query.matches) {
    callback();
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export {
  toggleMobileNav,
  openMobileNav,
  closeMobileNav,
  setupHamburgerMenu,
  setupResponsiveBreakpoints,
  setupTouchOptimizations,
};
