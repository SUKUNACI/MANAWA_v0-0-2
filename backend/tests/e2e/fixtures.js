/**
 * E2E Test Fixtures
 * Centralized test data for all E2E tests
 */

const bcrypt = require('bcryptjs');

const TEST_PASSWORD = 'Test@Manawa2024!';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

/**
 * User fixtures for different roles and scenarios
 */
const users = {
  // Client (particulier)
  client1: {
    email: `client-${Date.now()}-1@test.manawa.com`,
    password: TEST_PASSWORD,
    firstName: 'Jean',
    lastName: 'Dupont',
    phone: '+33612345678',
    city: 'Paris',
    role: 'CLIENT',
  },
  client2: {
    email: `client-${Date.now()}-2@test.manawa.com`,
    password: TEST_PASSWORD,
    firstName: 'Marie',
    lastName: 'Martin',
    phone: '+33687654321',
    city: 'Lyon',
    role: 'CLIENT',
  },

  // Professional (artisan)
  professional1: {
    email: `pro-${Date.now()}-1@test.manawa.com`,
    password: TEST_PASSWORD,
    firstName: 'Pierre',
    lastName: 'Boulanger',
    phone: '+33712345678',
    city: 'Paris',
    role: 'PROFESSIONAL',
    businessName: 'Plomberie Boulanger',
    businessType: 'PLUMBING',
    siret: '12345678901234',
  },
  professional2: {
    email: `pro-${Date.now()}-2@test.manawa.com`,
    password: TEST_PASSWORD,
    firstName: 'Sophie',
    lastName: 'Électricien',
    phone: '+33787654321',
    city: 'Lyon',
    role: 'PROFESSIONAL',
    businessName: 'Électricité Sophie',
    businessType: 'ELECTRICAL',
    siret: '98765432109876',
  },

  // Admin
  admin: {
    email: 'e2e-admin@test.manawa.com',
    password: TEST_PASSWORD,
    firstName: 'Admin',
    lastName: 'Test',
    role: 'ADMIN',
  },
};

/**
 * Project fixtures - typical construction/renovation projects
 */
const projects = {
  renovation: {
    title: 'Rénovation salle de bain',
    description: 'Rénovation complète de la salle de bain avec changement baignoire, carrelage',
    category: 'PLUMBING',
    budget: {
      min: 2000,
      max: 5000,
    },
    timeline: 'WITHIN_2_WEEKS',
    images: [],
    location: {
      city: 'Paris',
      postalCode: '75001',
    },
  },
  electrical: {
    title: 'Installation électrique',
    description: 'Installation de prises et interrupteurs supplémentaires',
    category: 'ELECTRICAL',
    budget: {
      min: 500,
      max: 1500,
    },
    timeline: 'WITHIN_1_WEEK',
    images: [],
    location: {
      city: 'Paris',
      postalCode: '75002',
    },
  },
  roofing: {
    title: 'Réparation toiture',
    description: 'Réparation de fuites et remplacement des tuiles endommagées',
    category: 'ROOFING',
    budget: {
      min: 3000,
      max: 8000,
    },
    timeline: 'WITHIN_3_WEEKS',
    images: [],
    location: {
      city: 'Lyon',
      postalCode: '69001',
    },
  },
};

/**
 * Quote fixtures for testing payment flows
 */
const quotes = {
  standard: {
    amount: 2500,
    description: 'Devis pour rénovation salle de bain',
    validDays: 30,
    services: ['Plomberie', 'Carrelage'],
  },
  premium: {
    amount: 5000,
    description: 'Devis complet rénovation',
    validDays: 30,
    services: ['Plomberie', 'Électricité', 'Carrelage', 'Peinture'],
  },
};

/**
 * Booking fixtures for testing booking flows
 */
const bookings = {
  standard: {
    startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 14 days from now
    duration: 7,
    notes: 'Veuillez arriver à 9h le matin',
  },
  weekend: {
    startDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() + ((6 - d.getDay()) % 7) || 7); // Next Saturday
      return d.toISOString().split('T')[0];
    })(),
    endDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7) || 8); // Next Sunday
      return d.toISOString().split('T')[0];
    })(),
    duration: 1,
    notes: 'Fin de semaine',
  },
};

/**
 * Payment fixtures
 */
const payments = {
  card: {
    cardNumber: '4532015112830366',
    expiryDate: '12/25',
    cvv: '123',
    holderName: 'Jean Dupont',
  },
  largeAmount: {
    amount: 50000, // 500 euros in cents
    currency: 'EUR',
    description: 'Paiement devis rénovation',
  },
};

/**
 * Message fixtures for messaging flow tests
 */
const messages = {
  inquiry: {
    subject: 'Demande de devis rénovation',
    content: 'Bonjour, pourriez-vous me proposer un devis pour la rénovation de ma salle de bain?',
  },
  followUp: {
    content: 'Pourriez-vous préciser votre disponibilité?',
  },
  negotiation: {
    content: 'Pouvez-vous baisser un peu le prix?',
  },
};

/**
 * Review fixtures for rating flows
 */
const reviews = {
  excellent: {
    rating: 5,
    title: 'Excellent travail',
    comment: 'Très satisfait de la qualité du travail et du professionnalisme',
    verified: true,
  },
  poor: {
    rating: 2,
    title: 'Travail non conforme',
    comment: 'Le travail n\'était pas conforme à la demande',
    verified: true,
  },
};

/**
 * Support ticket fixtures
 */
const supportTickets = {
  bug: {
    category: 'BUG',
    subject: 'Bug: Impossible de modifier le profil',
    description: 'Quand j\'essaie de modifier mon profil, j\'obtiens une erreur 500',
    priority: 'HIGH',
  },
  question: {
    category: 'QUESTION',
    subject: 'Comment modifier mon planning de disponibilité?',
    description: 'Je ne trouve pas où modifier mes horaires de disponibilité',
    priority: 'MEDIUM',
  },
};

/**
 * Report/Moderation fixtures
 */
const reports = {
  inappropriateProfile: {
    type: 'INAPPROPRIATE_PROFILE',
    reason: 'Profil contenant des contenus offensants',
    description: 'Le profil professionnel contient des images inappropriées',
  },
  spam: {
    type: 'SPAM',
    reason: 'Messages spam',
    description: 'Reçoit des messages de spam répétitifs',
  },
};

/**
 * Notification fixtures
 */
const notifications = {
  newMessage: {
    type: 'MESSAGE',
    title: 'Nouveau message',
    body: 'Vous avez reçu un nouveau message',
  },
  quoteAccepted: {
    type: 'QUOTE_ACCEPTED',
    title: 'Devis accepté',
    body: 'Votre devis a été accepté',
  },
};

/**
 * Helper to generate unique emails
 */
function generateUniqueEmail(prefix = 'test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@test.manawa.com`;
}

/**
 * Helper to generate unique data
 */
function generateUniqueData(template = {}) {
  return {
    ...template,
    email: generateUniqueEmail(template.email || 'test'),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Helper to create test user objects with hashed passwords
 */
async function createTestUser(userData) {
  return {
    ...userData,
    passwordHash: await bcrypt.hash(userData.password, 10),
  };
}

module.exports = {
  TEST_PASSWORD,
  API_BASE_URL,
  users,
  projects,
  quotes,
  bookings,
  payments,
  messages,
  reviews,
  supportTickets,
  reports,
  notifications,
  generateUniqueEmail,
  generateUniqueData,
  createTestUser,
};
