/**
 * E2E Tests: Professional Onboarding Flow
 * Tests complete professional setup, verification, and profile activation
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: Professional Onboarding Flow', () => {
  let professionalClient;
  const baseUrl = '/professionals';

  beforeEach(() => {
    professionalClient = createTestClient();
  });

  describe('Happy Path: Complete Professional Setup', () => {
    test('1. Professional can register and setup complete profile', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-setup'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Pierre',
        lastName: 'Boulanger',
        role: 'PROFESSIONAL',
      };

      const regRes = await professionalClient.register(userData);
      Assertions.status(regRes, 201);

      // Update professional profile
      const profileData = {
        businessName: 'Plomberie Boulanger SARL',
        businessType: 'PLUMBING',
        siret: '12345678901234',
        phone: '+33612345678',
        city: 'Paris',
        address: '123 Rue de la Paix',
        postalCode: '75001',
        description: 'Expert en plomberie depuis 15 ans',
      };

      const profileRes = await professionalClient.put(
        `${baseUrl}/profile`,
        profileData
      );

      Assertions.success(profileRes);
      Assertions.hasProperties(profileRes.data, ['businessName', 'businessType']);
      expect(profileRes.data.businessName).toBe(profileData.businessName);
    });

    test('2. Professional can upload business documents', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-docs'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Marie',
        lastName: 'Électricien',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      // Mock document upload
      const docData = {
        documentType: 'SIRET_CERTIFICATE',
        url: 'https://example.com/siret.pdf',
        verified: false,
      };

      const docRes = await professionalClient.post(
        `${baseUrl}/documents`,
        docData
      );

      Assertions.success(docRes);
    });

    test('3. Professional can set availability schedule', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-avail'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Sophie',
        lastName: 'Plombière',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const availabilityData = {
        Monday: { startTime: '08:00', endTime: '18:00' },
        Tuesday: { startTime: '08:00', endTime: '18:00' },
        Wednesday: { startTime: '08:00', endTime: '18:00' },
        Thursday: { startTime: '08:00', endTime: '18:00' },
        Friday: { startTime: '08:00', endTime: '17:00' },
        Saturday: { startTime: '09:00', endTime: '13:00' },
        Sunday: null, // Closed
      };

      const res = await professionalClient.post(
        `${baseUrl}/availability`,
        availabilityData
      );

      Assertions.success(res);
    });

    test('4. Professional profile activation after complete setup', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-activate'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Menuisier',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      // Complete profile
      await professionalClient.put(`${baseUrl}/profile`, {
        businessName: 'Menuiserie Jean',
        businessType: 'CARPENTRY',
        siret: '98765432109876',
      });

      // Activate profile
      const activateRes = await professionalClient.post(
        `${baseUrl}/activate`,
        { ready: true }
      );

      Assertions.success(activateRes);
      expect(activateRes.data.profileStatus).toBe('ACTIVE');
    });

    test('5. Professional can view and edit portfolio', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-portfolio'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Alice',
        lastName: 'Architecte',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      // Add portfolio project
      const portfolioData = {
        title: 'Rénovation maison ancienne',
        description: 'Rénovation complète maison de 150m²',
        images: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        category: 'RENOVATION',
        completionDate: '2024-01-15',
      };

      const res = await professionalClient.post(
        '/portfolio-projects',
        portfolioData
      );

      Assertions.success(res);
      expect(res.data.title).toBe(portfolioData.title);
    });
  });

  describe('Error Path: Invalid Onboarding Data', () => {
    test('1. Reject invalid business type', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-invalid'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const invalidData = {
        businessName: 'Test Company',
        businessType: 'INVALID_TYPE',
        siret: '12345678901234',
      };

      const res = await professionalClient.put(`${baseUrl}/profile`, invalidData);

      Assertions.error(res, 400);
    });

    test('2. Reject invalid SIRET format', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-siret'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const invalidData = {
        businessName: 'Test Company',
        businessType: 'PLUMBING',
        siret: 'INVALID', // Too short, should be 14 digits
      };

      const res = await professionalClient.put(`${baseUrl}/profile`, invalidData);

      Assertions.error(res, 400);
    });

    test('3. Prevent profile activation without required fields', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-incomplete'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      // Try to activate without completing profile
      const res = await professionalClient.post(`${baseUrl}/activate`, {
        ready: true,
      });

      Assertions.error(res, 400);
    });

    test('4. Reject invalid availability times', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-avail-invalid'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const invalidAvailability = {
        Monday: { startTime: '18:00', endTime: '08:00' }, // End before start
      };

      const res = await professionalClient.post(
        `${baseUrl}/availability`,
        invalidAvailability
      );

      Assertions.error(res, 400);
    });

    test('5. Reject invalid document uploads', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-doc-invalid'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const invalidDoc = {
        documentType: 'INVALID_TYPE',
        url: 'not-a-url',
      };

      const res = await professionalClient.post(
        `${baseUrl}/documents`,
        invalidDoc
      );

      Assertions.error(res, 400);
    });
  });

  describe('Edge Cases: Boundary Conditions', () => {
    test('1. Professional can update profile multiple times', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-updates'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const profileData1 = {
        businessName: 'Company V1',
        businessType: 'PLUMBING',
      };

      const res1 = await professionalClient.put(
        `${baseUrl}/profile`,
        profileData1
      );
      Assertions.success(res1);

      const profileData2 = {
        businessName: 'Company V2',
        businessType: 'ELECTRICAL',
      };

      const res2 = await professionalClient.put(
        `${baseUrl}/profile`,
        profileData2
      );
      Assertions.success(res2);
      expect(res2.data.businessName).toBe(profileData2.businessName);
    });

    test('2. Handle very long business descriptions', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-long-desc'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const profileData = {
        businessName: 'Test Company',
        businessType: 'PLUMBING',
        description: 'A'.repeat(5000), // Very long
      };

      const res = await professionalClient.put(
        `${baseUrl}/profile`,
        profileData
      );

      // Should either truncate or reject with clear error
      expect([200, 400]).toContain(res.status);
    });

    test('3. Professional availability across timezone boundary', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-tz'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const availability = {
        Monday: { startTime: '22:00', endTime: '06:00' }, // Crosses midnight
      };

      const res = await professionalClient.post(
        `${baseUrl}/availability`,
        availability
      );

      // Should handle gracefully
      expect([200, 400]).toContain(res.status);
    });

    test('4. Handle special characters in business name', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-special'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      const profileData = {
        businessName: "L'Électricité & Cie. (SARL) - BTP/Énergies",
        businessType: 'ELECTRICAL',
      };

      const res = await professionalClient.put(
        `${baseUrl}/profile`,
        profileData
      );

      Assertions.success(res);
      expect(res.data.businessName).toBe(profileData.businessName);
    });

    test('5. Professional portfolio with multiple projects', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-portfolio-multi'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      await professionalClient.register(userData);

      // Add 5 projects
      const projects = [];
      for (let i = 0; i < 5; i++) {
        const res = await professionalClient.post('/portfolio-projects', {
          title: `Project ${i + 1}`,
          description: `Description for project ${i + 1}`,
          category: 'RENOVATION',
          completionDate: '2024-01-15',
        });
        Assertions.success(res);
        projects.push(res.data);
      }

      // Verify all projects exist
      expect(projects.length).toBe(5);
    });
  });

  describe('Security: Professional Data Protection', () => {
    test('1. Only professional can modify their own profile', async () => {
      const pro1Data = {
        email: fixtures.generateUniqueEmail('pro-security-1'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Pro',
        lastName: 'One',
        role: 'PROFESSIONAL',
      };

      const pro2Data = {
        email: fixtures.generateUniqueEmail('pro-security-2'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Pro',
        lastName: 'Two',
        role: 'PROFESSIONAL',
      };

      const pro1Client = createTestClient();
      const pro2Client = createTestClient();

      await pro1Client.register(pro1Data);
      await pro2Client.register(pro2Data);

      // Pro1 updates their profile
      const updateRes = await pro1Client.put(`${baseUrl}/profile`, {
        businessName: 'Company One',
        businessType: 'PLUMBING',
      });
      Assertions.success(updateRes);

      // Pro2 tries to update Pro1's profile (should fail)
      const unauthorizedRes = await pro2Client.put(
        `${baseUrl}/${pro1Client.userId}/profile`,
        {
          businessName: 'Hacked Company',
          businessType: 'ELECTRICAL',
        }
      );

      Assertions.error(unauthorizedRes, 403);
    });

    test('2. SIRET not returned unverified', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro-siret-security'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'Pro',
        role: 'PROFESSIONAL',
      };

      const client = createTestClient();
      await client.register(userData);

      const profileRes = await client.put(`${baseUrl}/profile`, {
        businessName: 'Test Company',
        businessType: 'PLUMBING',
        siret: '12345678901234',
      });

      // SIRET should not be returned if unverified
      if (!profileRes.data.siretVerified) {
        expect(profileRes.data.siret).toBeFalsy();
      }
    });
  });
});
