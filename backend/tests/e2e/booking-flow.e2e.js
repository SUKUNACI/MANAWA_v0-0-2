/**
 * E2E Tests: Complete Booking Flow
 * Tests project creation, quoting, and booking lifecycle
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: Complete Booking Flow', () => {
  let clientUser;
  let professionalUser;
  let project;

  beforeEach(async () => {
    clientUser = createTestClient();
    professionalUser = createTestClient();

    // Register users
    await clientUser.register({
      email: fixtures.generateUniqueEmail('client'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Jean',
      lastName: 'Client',
      role: 'CLIENT',
    });

    await professionalUser.register({
      email: fixtures.generateUniqueEmail('pro'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Pierre',
      lastName: 'Pro',
      role: 'PROFESSIONAL',
    });

    // Setup professional profile
    await professionalUser.put('/professionals/profile', {
      businessName: 'Plomberie Pro',
      businessType: 'PLUMBING',
      siret: '12345678901234',
    });
  });

  describe('Happy Path: Complete Booking Lifecycle', () => {
    test('1. Client can create project request', async () => {
      const projectData = {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète avec changement baignoire',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      };

      const response = await clientUser.post('/projects', projectData);

      Assertions.success(response);
      Assertions.validProject(response.data);
      expect(response.data.title).toBe(projectData.title);
      expect(response.data.status).toBe('OPEN');

      project = response.data;
    });

    test('2. Professional can browse and view projects', async () => {
      // Create project first
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      Assertions.success(projectRes);
      const projectId = projectRes.data.id;

      // Professional views project
      const viewRes = await professionalUser.get(`/projects/${projectId}`);

      Assertions.success(viewRes);
      Assertions.validProject(viewRes.data);
      expect(viewRes.data.id).toBe(projectId);
    });

    test('3. Professional can submit quote for project', async () => {
      // Create project
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      // Professional submits quote
      const quoteData = {
        projectId,
        amount: 3500,
        description: 'Devis rénovation salle de bain',
        validDays: 30,
      };

      const quoteRes = await professionalUser.post('/quotes', quoteData);

      Assertions.success(quoteRes);
      Assertions.validQuote(quoteRes.data);
      expect(quoteRes.data.amount).toBe(3500);
      expect(quoteRes.data.status).toBe('PENDING');
    });

    test('4. Client can review and accept quote', async () => {
      // Create project and quote
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis rénovation',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      // Client accepts quote
      const acceptRes = await clientUser.post(`/quotes/${quoteId}/accept`);

      Assertions.success(acceptRes);
      expect(acceptRes.data.status).toBe('ACCEPTED');
    });

    test('5. Create booking with accepted quote', async () => {
      // Setup: Create project, quote, accept it
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis rénovation',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      await clientUser.post(`/quotes/${quoteId}/accept`);

      // Create booking
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      const bookingData = {
        quoteId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        notes: 'Please arrive at 9am',
      };

      const bookingRes = await professionalUser.post('/bookings', bookingData);

      Assertions.success(bookingRes);
      Assertions.validBooking(bookingRes.data);
      expect(bookingRes.data.status).toBe('CONFIRMED');
    });

    test('6. Client can view booking confirmation', async () => {
      // Setup complete booking flow
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis rénovation',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;
      await clientUser.post(`/quotes/${quoteId}/accept`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      const bookingRes = await professionalUser.post('/bookings', {
        quoteId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      const bookingId = bookingRes.data.id;

      // Client views booking
      const viewRes = await clientUser.get(`/bookings/${bookingId}`);

      Assertions.success(viewRes);
      expect(viewRes.data.id).toBe(bookingId);
    });
  });

  describe('Error Path: Invalid Booking Operations', () => {
    test('1. Reject quote for non-existent project', async () => {
      const quoteData = {
        projectId: 'non-existent-id',
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      };

      const response = await professionalUser.post('/quotes', quoteData);

      Assertions.error(response, 404);
    });

    test('2. Prevent client from accepting rejected quote', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      // Client rejects quote
      await clientUser.post(`/quotes/${quoteId}/reject`);

      // Try to accept rejected quote (should fail)
      const acceptRes = await clientUser.post(`/quotes/${quoteId}/accept`);

      Assertions.error(acceptRes, 400);
    });

    test('3. Reject booking with invalid dates', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;
      await clientUser.post(`/quotes/${quoteId}/accept`);

      // Try to create booking with end date before start date
      const bookingRes = await professionalUser.post('/bookings', {
        quoteId,
        startDate: '2025-12-31',
        endDate: '2025-01-01', // Before start date
      });

      Assertions.error(bookingRes, 400);
    });

    test('4. Prevent overbooking on same dates', async () => {
      // Create first booking
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;
      await clientUser.post(`/quotes/${quoteId}/accept`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 3);

      await professionalUser.post('/bookings', {
        quoteId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      // Try to create overlapping booking
      const overlapRes = await professionalUser.post('/bookings', {
        quoteId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      Assertions.error(overlapRes, 400);
    });
  });

  describe('Edge Cases: Boundary Conditions', () => {
    test('1. Handle booking with same start and end date', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;
      await clientUser.post(`/quotes/${quoteId}/accept`);

      const date = new Date();
      date.setDate(date.getDate() + 7);
      const dateStr = date.toISOString().split('T')[0];

      const bookingRes = await professionalUser.post('/bookings', {
        quoteId,
        startDate: dateStr,
        endDate: dateStr,
      });

      expect([200, 400]).toContain(bookingRes.status);
    });

    test('2. Handle very large quote amounts', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 100000, max: 500000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 999999999, // Very large
        description: 'Devis',
        validDays: 30,
      });

      expect([200, 400]).toContain(quoteRes.status);
    });

    test('3. Multiple professionals can submit quotes for same project', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      // First quote
      const quote1Res = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis 1',
        validDays: 30,
      });

      Assertions.success(quote1Res);

      // Second professional
      const pro2 = createTestClient();
      await pro2.register({
        email: fixtures.generateUniqueEmail('pro2'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Sophie',
        lastName: 'Pro2',
        role: 'PROFESSIONAL',
      });

      await pro2.put('/professionals/profile', {
        businessName: 'Plomberie Pro 2',
        businessType: 'PLUMBING',
        siret: '98765432109876',
      });

      // Second quote
      const quote2Res = await pro2.post('/quotes', {
        projectId,
        amount: 3200,
        description: 'Devis 2',
        validDays: 30,
      });

      Assertions.success(quote2Res);
    });
  });

  describe('Security: Booking Authorization', () => {
    test('1. Only quote owner can accept/reject quotes', async () => {
      const otherClient = createTestClient();
      await otherClient.register({
        email: fixtures.generateUniqueEmail('other-client'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Other',
        lastName: 'Client',
        role: 'CLIENT',
      });

      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      // Other client tries to accept quote
      const acceptRes = await otherClient.post(`/quotes/${quoteId}/accept`);

      Assertions.error(acceptRes, 403);
    });

    test('2. Professional cannot accept own quotes', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const projectId = projectRes.data.id;

      const quoteRes = await professionalUser.post('/quotes', {
        projectId,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      // Professional tries to accept their own quote
      const acceptRes = await professionalUser.post(`/quotes/${quoteId}/accept`);

      Assertions.error(acceptRes, 403);
    });
  });
});
