/**
 * Manual Authentication Debug Test
 * Run: npx playwright test tests/backoffice-manual-auth.e2e.js --project=chromium
 *
 * This test manually walks through each step of authentication to debug issues.
 */

const { test, expect } = require('@playwright/test');

const BACKOFFICE_URL = 'https://manawa-backend.onrender.com/admin/';
const LOGIN_URL = 'https://manawa-backend.onrender.com/admin/login.html';
const ADMIN_EMAIL = 'app_manawa@proton.me';
const ADMIN_PASSWORD = '9ECE!f7305969@7DD86E';

test.describe('MANAWA Backoffice - Manual Auth Debug', () => {
  test('Step 1: Navigate to login page', async ({ page }) => {
    await page.goto(LOGIN_URL);
    console.log('✅ Login page loaded');

    const title = await page.title();
    console.log(`   Page title: ${title}`);

    const emailInput = await page.locator('#email');
    expect(emailInput).toBeTruthy();
    console.log('✅ Email input field exists');
  });

  test('Step 2: Test login POST request directly', async ({ page, context }) => {
    // Make a direct POST request to /api/auth/login
    const loginResponse = await context.request.post('https://manawa-backend.onrender.com/api/auth/login', {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    });

    const status = loginResponse.status();
    const body = await loginResponse.json();

    console.log(`📡 POST /api/auth/login status: ${status}`);
    console.log(`   Response:`, JSON.stringify(body, null, 2));

    if (status === 429) {
      console.log('❌ Rate limit exceeded! Account blocked for 1 hour.');
      return;
    }

    if (status !== 200) {
      console.log(`❌ Login failed with status ${status}: ${body.error}`);
      return;
    }

    const token = body.token;
    console.log(`✅ Login successful. Token: ${token?.substring(0, 20)}...`);

    // Step 3: Create admin session
    const sessionResponse = await context.request.post('https://manawa-backend.onrender.com/api/auth/admin-session', {
      data: { token },
    });

    const sessionStatus = sessionResponse.status();
    const sessionBody = await sessionResponse.json();

    console.log(`📡 POST /api/auth/admin-session status: ${sessionStatus}`);
    console.log(`   Response:`, JSON.stringify(sessionBody, null, 2));

    if (sessionStatus !== 200) {
      console.log(`❌ Session creation failed: ${sessionBody.error}`);
      return;
    }

    console.log('✅ Admin session created');

    // Check cookies
    const cookies = await context.cookies();
    const adminToken = cookies.find(c => c.name === 'adminToken');
    const adminCsrf = cookies.find(c => c.name === 'adminCsrf');

    console.log(`   adminToken cookie: ${adminToken ? '✅ Set' : '❌ NOT SET'}`);
    console.log(`   adminCsrf cookie: ${adminCsrf ? '✅ Set' : '❌ NOT SET'}`);

    if (adminToken) {
      console.log(`      - httpOnly: ${adminToken.httpOnly}, secure: ${adminToken.secure}, sameSite: ${adminToken.sameSite}`);
    }
  });

  test('Step 3: Full browser auth flow', async ({ page }) => {
    const errors = [];
    const requests = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
        console.log(`❌ Console Error: ${msg.text()}`);
      }
    });

    page.on('response', response => {
      requests.push({
        url: response.url(),
        status: response.status(),
      });

      if (response.status() >= 400) {
        console.log(`❌ ${response.status()} ${response.url()}`);
      }
    });

    // Navigate to login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    console.log('✅ Login page loaded');

    // Fill form
    await page.fill('#email', ADMIN_EMAIL);
    console.log('✅ Email filled');

    await page.fill('#password', ADMIN_PASSWORD);
    console.log('✅ Password filled');

    // Click login
    await page.click('#btn');
    console.log('✅ Login button clicked');

    // Wait for redirect (with longer timeout)
    try {
      await page.waitForURL(BACKOFFICE_URL, { timeout: 15000 });
      console.log('✅ Redirected to dashboard');
    } catch (err) {
      console.log(`❌ Timeout waiting for redirect: ${err.message}`);
      console.log(`   Current URL: ${page.url()}`);

      // Log all requests that happened
      console.log(`   Total requests: ${requests.length}`);
      requests.filter(r => r.status >= 400).forEach(r => {
        console.log(`      - ${r.status} ${r.url}`);
      });

      return;
    }

    // Check session
    const cookies = await page.context().cookies();
    const adminToken = cookies.find(c => c.name === 'adminToken');
    const adminCsrf = cookies.find(c => c.name === 'adminCsrf');

    console.log(`   adminToken cookie: ${adminToken ? '✅' : '❌'}`);
    console.log(`   adminCsrf cookie: ${adminCsrf ? '✅' : '❌'}`);

    // Check dashboard loaded
    const dashboardContent = await page.locator('#kpi-pros').textContent();
    console.log(`   Dashboard KPI loaded: ${dashboardContent ? '✅' : '❌'}`);

    if (errors.length > 0) {
      console.log(`⚠️  Found ${errors.length} console errors:`);
      errors.forEach(e => console.log(`   - ${e}`));
    } else {
      console.log('✅ No console errors');
    }
  });
});
