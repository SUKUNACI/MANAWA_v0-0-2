/**
 * E2E Tests: Payment Processing Flow
 * Tests payment creation, processing, and settlement
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: Payment Processing Flow', () => {
  let clientUser;
  let professionalUser;

  beforeEach(async () => {
    clientUser = createTestClient();
    professionalUser = createTestClient();

    // Register users
    await clientUser.register({
      email: fixtures.generateUniqueEmail('client-payment'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Jean',
      lastName: 'Client',
      role: 'CLIENT',
    });

    await professionalUser.register({
      email: fixtures.generateUniqueEmail('pro-payment'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Pierre',
      lastName: 'Pro',
      role: 'PROFESSIONAL',
    });

    // Setup professional
    await professionalUser.put('/professionals/profile', {
      businessName: 'Plomberie Pro',
      businessType: 'PLUMBING',
      siret: '12345678901234',
    });
  });

  describe('Happy Path: Complete Payment Lifecycle', () => {
    test('1. Create payment request from accepted quote', async () => {
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
        description: 'Devis',
        validDays: 30,
      });

      const quoteId = quoteRes.data.id;

      // Accept quote
      await clientUser.post(`/quotes/${quoteId}/accept`);

      // Create payment
      const paymentRes = await clientUser.post('/payments', {
        quoteId,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      Assertions.success(paymentRes);
      Assertions.validPayment(paymentRes.data);
      expect(paymentRes.data.amount).toBe(3500);
      expect(paymentRes.data.status).toBe('pending');
    });

    test('2. Process card payment successfully', async () => {
      // Setup payment
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
        cardDetails: {
          cardNumber: '4532015112830366',
          expiryDate: '12/25',
          cvv: '123',
          holderName: 'Jean Dupont',
        },
      });

      Assertions.success(paymentRes);
      expect(paymentRes.data.paymentMethod).toBe('CARD');
    });

    test('3. Verify payment confirmation receipt', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      const paymentId = paymentRes.data.id;

      // Retrieve payment
      const retrieveRes = await clientUser.get(`/payments/${paymentId}`);

      Assertions.success(retrieveRes);
      expect(retrieveRes.data.id).toBe(paymentId);
      expect(retrieveRes.data.amount).toBe(3500);
    });

    test('4. Handle partial payment/deposit', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
        depositPercentage: 50,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      // Pay only deposit (50%)
      const depositRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 1750, // 50% of 3500
        paymentMethod: 'CARD',
        isDeposit: true,
      });

      Assertions.success(depositRes);
      expect(depositRes.data.amount).toBe(1750);
    });

    test('5. Process refund for cancelled booking', async () => {
      // Create and pay for booking
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      const paymentId = paymentRes.data.id;

      // Request refund
      const refundRes = await clientUser.post(`/payments/${paymentId}/refund`, {
        reason: 'Booking cancelled',
      });

      Assertions.success(refundRes);
      expect(['pending', 'processing', 'completed']).toContain(refundRes.data.status);
    });
  });

  describe('Error Path: Payment Failures', () => {
    test('1. Reject payment with invalid quote', async () => {
      const paymentRes = await clientUser.post('/payments', {
        quoteId: 'non-existent-quote',
        amount: 3500,
        paymentMethod: 'CARD',
      });

      Assertions.error(paymentRes, 404);
    });

    test('2. Reject payment with invalid card', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
        cardDetails: {
          cardNumber: '1234567890123456', // Invalid card
          expiryDate: '12/25',
          cvv: '123',
        },
      });

      Assertions.error(paymentRes, 400);
    });

    test('3. Reject payment amount mismatch', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      // Pay different amount than quote
      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 5000, // Different from 3500
        paymentMethod: 'CARD',
      });

      Assertions.error(paymentRes, 400);
    });

    test('4. Prevent duplicate payment for same quote', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      // First payment
      const res1 = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      Assertions.success(res1);

      // Try second payment for same quote
      const res2 = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      // Should fail or mark quote as already paid
      expect([400, 409]).toContain(res2.status);
    });

    test('5. Reject refund on non-refundable payment', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
        refundable: false,
      });

      const paymentId = paymentRes.data.id;

      // Try to refund non-refundable payment
      const refundRes = await clientUser.post(`/payments/${paymentId}/refund`, {
        reason: 'Changed mind',
      });

      Assertions.error(refundRes, 400);
    });
  });

  describe('Edge Cases: Payment Boundary Conditions', () => {
    test('1. Handle very large payment amounts', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 100000, max: 500000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 250000,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 250000,
        paymentMethod: 'CARD',
      });

      expect([200, 400]).toContain(paymentRes.status);
    });

    test('2. Handle very small payment amounts (cents)', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 1, max: 10 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 1,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 1,
        paymentMethod: 'CARD',
      });

      expect([200, 400]).toContain(paymentRes.status);
    });

    test('3. Multiple refunds for partial payments', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
        depositPercentage: 30, // 30% deposit, 70% final
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      // Payment 1: Deposit
      const payment1Res = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 1050,
        paymentMethod: 'CARD',
        isDeposit: true,
      });

      // Payment 2: Final
      const payment2Res = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 2450,
        paymentMethod: 'CARD',
      });

      // Both exist
      Assertions.success(payment1Res);
      Assertions.success(payment2Res);
    });
  });

  describe('Security: Payment Data Protection', () => {
    test('1. Card details not returned in response', async () => {
      const projectRes = await clientUser.post('/projects', {
        title: 'Rénovation salle de bain',
        description: 'Rénovation complète',
        category: 'PLUMBING',
        budget: { min: 2000, max: 5000 },
        timeline: 'WITHIN_2_WEEKS',
        location: { city: 'Paris', postalCode: '75001' },
      });

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
        cardDetails: {
          cardNumber: '4532015112830366',
          expiryDate: '12/25',
          cvv: '123',
        },
      });

      Assertions.noSensitiveData(paymentRes.data, [
        'cardNumber',
        'cvv',
        'cardDetails',
      ]);
    });

    test('2. Payment only accessible to involved parties', async () => {
      const otherClient = createTestClient();
      await otherClient.register({
        email: fixtures.generateUniqueEmail('other'),
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

      const quoteRes = await professionalUser.post('/quotes', {
        projectId: projectRes.data.id,
        amount: 3500,
        description: 'Devis',
        validDays: 30,
      });

      await clientUser.post(`/quotes/${quoteRes.data.id}/accept`);

      const paymentRes = await clientUser.post('/payments', {
        quoteId: quoteRes.data.id,
        amount: 3500,
        paymentMethod: 'CARD',
      });

      const paymentId = paymentRes.data.id;

      // Other client tries to access payment
      const accessRes = await otherClient.get(`/payments/${paymentId}`);

      Assertions.error(accessRes, 403);
    });
  });
});
