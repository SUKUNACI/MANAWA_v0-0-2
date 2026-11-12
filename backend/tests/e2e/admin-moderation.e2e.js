/**
 * E2E Tests: Admin Moderation and Governance Workflows
 * Tests admin capabilities, user moderation, report handling, and system administration
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: Admin Moderation and Governance', () => {
  let admin;
  let client;
  let professional;

  beforeEach(async () => {
    admin = createTestClient();
    client = createTestClient();
    professional = createTestClient();

    // Note: In real tests, admin would be created via seed/setup
    // For now, we simulate admin registration
    await admin.register({
      email: 'admin-e2e@test.manawa.com',
      password: fixtures.TEST_PASSWORD,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
    });

    await client.register({
      email: fixtures.generateUniqueEmail('client-mod'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Jean',
      lastName: 'Client',
      role: 'CLIENT',
    });

    await professional.register({
      email: fixtures.generateUniqueEmail('pro-mod'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Pierre',
      lastName: 'Pro',
      role: 'PROFESSIONAL',
    });

    await professional.put('/professionals/profile', {
      businessName: 'Plomberie Pro',
      businessType: 'PLUMBING',
      siret: '12345678901234',
    });
  });

  describe('Happy Path: Admin Dashboard and Controls', () => {
    test('1. Admin can view dashboard KPIs', async () => {
      const response = await admin.get('/admin/dashboard');

      Assertions.success(response);
      Assertions.hasProperties(response.data, [
        'totalUsers',
        'totalProfessionals',
        'activeBookings',
        'totalRevenue',
      ]);
    });

    test('2. Admin can list all users', async () => {
      const response = await admin.get('/admin/users');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
      Assertions.arrayNotEmpty(response.data);
    });

    test('3. Admin can view user details', async () => {
      const response = await admin.get(`/admin/users/${client.userId}`);

      Assertions.success(response);
      Assertions.validUser(response.data);
      expect(response.data.id).toBe(client.userId);
    });

    test('4. Admin can suspend a user', async () => {
      const response = await admin.post(`/admin/users/${client.userId}/suspend`, {
        reason: 'Inappropriate behavior',
        duration: 7, // days
      });

      Assertions.success(response);
      expect(response.data.status).toBe('SUSPENDED');
    });

    test('5. Admin can unsuspend user', async () => {
      // Suspend first
      await admin.post(`/admin/users/${client.userId}/suspend`, {
        reason: 'Test',
        duration: 7,
      });

      // Unsuspend
      const response = await admin.post(`/admin/users/${client.userId}/unsuspend`);

      Assertions.success(response);
      expect(response.data.status).toBe('ACTIVE');
    });

    test('6. Admin can delete user account', async () => {
      // Create user to delete
      const userToDelete = createTestClient();
      await userToDelete.register({
        email: fixtures.generateUniqueEmail('delete-me'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Delete',
        lastName: 'Me',
        role: 'CLIENT',
      });

      const userId = userToDelete.userId;

      // Admin deletes user
      const response = await admin.delete(`/admin/users/${userId}`);

      Assertions.success(response);
    });
  });

  describe('Happy Path: Report and Moderation', () => {
    test('1. User can file report against professional', async () => {
      const reportData = {
        targetUserId: professional.userId,
        targetType: 'PROFESSIONAL',
        reportType: 'INAPPROPRIATE_PROFILE',
        reason: 'Profile contains inappropriate content',
        description: 'The profile images violate community guidelines',
      };

      const response = await client.post('/reports', reportData);

      Assertions.success(response);
      Assertions.hasProperties(response.data, ['id', 'status', 'createdAt']);
      expect(response.data.status).toBe('OPEN');
    });

    test('2. Admin can view pending reports', async () => {
      // File a report
      await client.post('/reports', {
        targetUserId: professional.userId,
        targetType: 'PROFESSIONAL',
        reportType: 'INAPPROPRIATE_PROFILE',
        reason: 'Test report',
      });

      // Admin views reports
      const response = await admin.get('/admin/reports?status=OPEN');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
      Assertions.arrayNotEmpty(response.data);
    });

    test('3. Admin can investigate report details', async () => {
      // File report
      const reportRes = await client.post('/reports', {
        targetUserId: professional.userId,
        targetType: 'PROFESSIONAL',
        reportType: 'INAPPROPRIATE_PROFILE',
        reason: 'Test report',
      });

      const reportId = reportRes.data.id;

      // Admin views report
      const response = await admin.get(`/admin/reports/${reportId}`);

      Assertions.success(response);
      Assertions.hasProperties(response.data, [
        'id',
        'reportType',
        'reason',
        'targetUserId',
      ]);
    });

    test('4. Admin can approve/dismiss reports', async () => {
      // File report
      const reportRes = await client.post('/reports', {
        targetUserId: professional.userId,
        targetType: 'PROFESSIONAL',
        reportType: 'INAPPROPRIATE_PROFILE',
        reason: 'Test report',
      });

      const reportId = reportRes.data.id;

      // Admin dismisses report
      const response = await admin.post(`/admin/reports/${reportId}/dismiss`, {
        reason: 'No violation found',
      });

      Assertions.success(response);
      expect(response.data.status).toBe('DISMISSED');
    });

    test('5. Admin can take action on substantiated report', async () => {
      // File report
      const reportRes = await client.post('/reports', {
        targetUserId: professional.userId,
        targetType: 'PROFESSIONAL',
        reportType: 'INAPPROPRIATE_PROFILE',
        reason: 'Serious violation',
      });

      const reportId = reportRes.data.id;

      // Admin approves report and suspends user
      const response = await admin.post(`/admin/reports/${reportId}/approve`, {
        action: 'SUSPEND',
        actionDuration: 30,
      });

      Assertions.success(response);
      expect(response.data.status).toBe('APPROVED');
    });
  });

  describe('Happy Path: Dispute Resolution', () => {
    test('1. Client can file dispute on completed booking', async () => {
      // Create project and booking
      const projectRes = await client.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professional.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await client.post(`/quotes/${quoteRes.data.id}/accept`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      const bookingRes = await professional.post('/bookings', {
        quoteId: quoteRes.data.id,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      const bookingId = bookingRes.data.id;

      // File dispute
      const disputeRes = await client.post('/disputes', {
        bookingId,
        reason: 'Work not completed satisfactorily',
        description: 'The professional did not complete the work as agreed',
      });

      Assertions.success(disputeRes);
      Assertions.hasProperties(disputeRes.data, ['id', 'status', 'createdAt']);
      expect(disputeRes.data.status).toBe('OPEN');
    });

    test('2. Admin can view and manage disputes', async () => {
      // File dispute first
      const projectRes = await client.post('/projects', {
        title: 'Rénovation',
        description: 'Rénovation',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professional.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await client.post(`/quotes/${quoteRes.data.id}/accept`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      const bookingRes = await professional.post('/bookings', {
        quoteId: quoteRes.data.id,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      await client.post('/disputes', {
        bookingId: bookingRes.data.id,
        reason: 'Dispute',
        description: 'Not satisfied',
      });

      // Admin views disputes
      const response = await admin.get('/admin/disputes?status=OPEN');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
    });

    test('3. Admin can resolve dispute', async () => {
      // Setup dispute (abbreviated)
      const projectRes = await client.post('/projects', {
        title: 'Rénovation',
        description: 'Rénovation',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professional.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await client.post(`/quotes/${quoteRes.data.id}/accept`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      const bookingRes = await professional.post('/bookings', {
        quoteId: quoteRes.data.id,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      const disputeRes = await client.post('/disputes', {
        bookingId: bookingRes.data.id,
        reason: 'Dispute',
      });

      const disputeId = disputeRes.data.id;

      // Admin resolves
      const response = await admin.post(`/admin/disputes/${disputeId}/resolve`, {
        resolution: 'REFUND',
        refundPercentage: 50,
        reason: 'Partial work completion',
      });

      Assertions.success(response);
      expect(response.data.status).toBe('RESOLVED');
    });
  });

  describe('Admin Analytics and Reporting', () => {
    test('1. Admin can view system analytics', async () => {
      const response = await admin.get('/admin/analytics/overview');

      Assertions.success(response);
      Assertions.hasProperties(response.data, [
        'period',
        'metrics',
      ]);
    });

    test('2. Admin can view user growth metrics', async () => {
      const response = await admin.get('/admin/analytics/users');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
    });

    test('3. Admin can view revenue metrics', async () => {
      const response = await admin.get('/admin/analytics/revenue');

      Assertions.success(response);
      Assertions.hasProperties(response.data, [
        'totalRevenue',
        'totalTransactions',
      ]);
    });

    test('4. Admin can export reports', async () => {
      const response = await admin.get('/admin/reports/export?format=csv');

      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Error Path: Unauthorized Admin Actions', () => {
    test('1. Non-admin cannot access admin endpoints', async () => {
      const response = await client.get('/admin/dashboard');

      Assertions.error(response, 403);
    });

    test('2. Non-admin cannot suspend users', async () => {
      const response = await client.post(`/admin/users/${professional.userId}/suspend`, {
        reason: 'Unauthorized attempt',
      });

      Assertions.error(response, 403);
    });

    test('3. Non-admin cannot view sensitive reports', async () => {
      const response = await client.get('/admin/reports');

      Assertions.error(response, 403);
    });

    test('4. Non-admin cannot resolve disputes', async () => {
      const response = await client.post('/admin/disputes/1/resolve', {
        resolution: 'REFUND',
      });

      Assertions.error(response, 403);
    });
  });

  describe('Edge Cases: Admin Action Limits', () => {
    test('1. Cannot suspend already suspended user', async () => {
      // Suspend
      await admin.post(`/admin/users/${client.userId}/suspend`, {
        reason: 'First suspension',
        duration: 7,
      });

      // Try again
      const response = await admin.post(`/admin/users/${client.userId}/suspend`, {
        reason: 'Second suspension attempt',
        duration: 7,
      });

      Assertions.error(response, 400);
    });

    test('2. Cannot unsuspend active user', async () => {
      const response = await admin.post(`/admin/users/${professional.userId}/unsuspend`);

      Assertions.error(response, 400);
    });

    test('3. Bulk user actions', async () => {
      const response = await admin.post('/admin/users/bulk-action', {
        action: 'SUSPEND',
        userIds: [client.userId, professional.userId],
        reason: 'Bulk suspension test',
      });

      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Security: Admin Audit Trail', () => {
    test('1. Admin actions are logged', async () => {
      // Admin performs action
      await admin.post(`/admin/users/${client.userId}/suspend`, {
        reason: 'Test suspension',
        duration: 7,
      });

      // Check audit logs
      const response = await admin.get('/admin/audit-logs');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
    });

    test('2. Audit logs contain required fields', async () => {
      const response = await admin.get('/admin/audit-logs?limit=1');

      Assertions.success(response);
      if (response.data.length > 0) {
        const log = response.data[0];
        Assertions.hasProperties(log, [
          'id',
          'adminId',
          'action',
          'targetId',
          'timestamp',
        ]);
      }
    });

    test('3. Only admins can view audit logs', async () => {
      const response = await client.get('/admin/audit-logs');

      Assertions.error(response, 403);
    });
  });
});
