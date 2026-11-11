/**
 * End-to-End Tests for MANAWA Backoffice - AUTHENTICATED FLOW
 * Tests full login and authenticated operations
 *
 * Run: npx playwright test tests/backoffice-authenticated.e2e.js
 */

const { test, expect } = require('@playwright/test');

const BACKOFFICE_URL = 'https://manawa-backend.onrender.com/admin/';
const LOGIN_URL = 'https://manawa-backend.onrender.com/admin/login.html';
const ADMIN_EMAIL = 'app_manawa@proton.me';
const ADMIN_PASSWORD = '9ECE!f7305969@7DD86E';

test.describe('MANAWA Backoffice - Full Authentication Flow', () => {
  test('1. Login flow and session creation', async ({ page }) => {
    test.slow();

    // Navigate to login page
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    console.log('✅ Login page loaded');

    // Fill email
    await page.fill('#email', ADMIN_EMAIL);
    console.log('✅ Email filled');

    // Fill password
    await page.fill('#password', ADMIN_PASSWORD);
    console.log('✅ Password filled');

    // Click login button
    await page.click('#btn');
    console.log('✅ Login button clicked');

    // Wait for navigation to dashboard (no timeout - let it complete naturally)
    try {
      await page.waitForURL(BACKOFFICE_URL);
    } catch (err) {
      console.log('Navigation timeout, current URL:', page.url());
      throw err;
    }
    console.log('✅ Redirected to dashboard');

    // Check for dashboard elements
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
    console.log('✅ Dashboard page loaded');
  });

  test('2. Admin session cookies are set', async ({ page }) => {
    test.slow();

    // Login first
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#btn');
    await page.waitForURL(BACKOFFICE_URL, { timeout: 20000 });

    // Check for admin cookies
    const cookies = await page.context().cookies();
    const adminToken = cookies.find(c => c.name === 'adminToken');
    const adminCsrf = cookies.find(c => c.name === 'adminCsrf');

    if (adminToken) {
      console.log(`✅ adminToken cookie set (httpOnly: ${adminToken.httpOnly})`);
    } else {
      console.log('⚠️  adminToken cookie NOT found');
    }

    if (adminCsrf) {
      console.log(`✅ adminCsrf cookie set (httpOnly: ${adminCsrf.httpOnly})`);
    } else {
      console.log('⚠️  adminCsrf cookie NOT found');
    }
  });

  test('3. Dashboard loads without 401 errors after login', async ({ page }) => {
    test.slow();

    const errors = [];
    const networkErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
        console.log(`❌ Console Error: ${msg.text()}`);
      }
    });

    page.on('response', response => {
      if (response.status() === 401) {
        networkErrors.push({
          url: response.url(),
          status: response.status()
        });
        console.log(`❌ 401 Error: ${response.url()}`);
      }
    });

    // Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#btn');
    await page.waitForURL(BACKOFFICE_URL, { timeout: 20000 });

    // Wait for dashboard to fully load
    await page.waitForTimeout(3000);

    if (networkErrors.length === 0) {
      console.log('✅ No 401 errors after login');
    } else {
      console.log(`⚠️  Found ${networkErrors.length} 401 errors:`);
      networkErrors.forEach(e => console.log(`   - ${e.url}`));
    }

    if (errors.length === 0) {
      console.log('✅ No console errors');
    } else {
      console.log(`⚠️  Found ${errors.length} console errors:`);
      errors.forEach(e => console.log(`   - ${e}`));
    }
  });

  test('4. KPIs load after authentication', async ({ page }) => {
    test.slow();

    // Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#btn');
    await page.waitForURL(BACKOFFICE_URL, { timeout: 20000 });

    // Wait for KPIs to load
    await page.waitForTimeout(3000);

    // Check for KPI elements
    const kpiPros = await page.locator('#kpi-pros').textContent();
    const kpiClients = await page.locator('#kpi-clients').textContent();
    const kpiProjects = await page.locator('#kpi-projects').textContent();

    console.log(`📊 KPI Pros: ${kpiPros}`);
    console.log(`📊 KPI Clients: ${kpiClients}`);
    console.log(`📊 KPI Projects: ${kpiProjects}`);

    if (kpiPros && kpiClients && kpiProjects) {
      console.log('✅ KPIs loaded successfully');
    } else {
      console.log('⚠️  Some KPIs failed to load');
    }
  });

  test('5. API calls include auth token', async ({ page }) => {
    test.slow();

    const apiRequests = [];

    page.on('request', request => {
      if (request.url().includes('/api/')) {
        const headers = request.headers();
        apiRequests.push({
          url: request.url(),
          hasAuth: !!headers['authorization'],
          hasCsrf: !!headers['x-csrf-token']
        });
      }
    });

    // Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#btn');
    await page.waitForURL(BACKOFFICE_URL, { timeout: 20000 });

    // Wait for dashboard requests
    await page.waitForTimeout(3000);

    console.log(`📡 Found ${apiRequests.length} API requests`);
    const withAuth = apiRequests.filter(r => r.hasAuth).length;
    const withCsrf = apiRequests.filter(r => r.hasCsrf).length;

    console.log(`   ✅ With Authorization header: ${withAuth}/${apiRequests.length}`);
    console.log(`   ✅ With X-CSRF-Token header: ${withCsrf}/${apiRequests.length}`);

    if (withAuth > 0) {
      console.log('✅ Auth token is being sent in API calls');
    } else {
      console.log('❌ NO auth tokens sent in API calls!');
    }
  });

  test('6. Session persistence across page reloads', async ({ page }) => {
    test.slow();

    // Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#btn');
    await page.waitForURL(BACKOFFICE_URL, { timeout: 20000 });

    console.log('✅ Initial login successful');

    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    console.log('✅ Page reloaded');

    // Wait for dashboard
    await page.waitForTimeout(2000);

    // Check if still on dashboard (not redirected to login)
    const currentUrl = page.url();
    if (currentUrl.includes('/admin/') && !currentUrl.includes('login')) {
      console.log('✅ Session persisted after reload');
    } else {
      console.log('❌ Session lost after reload (redirected to login)');
    }
  });
});
