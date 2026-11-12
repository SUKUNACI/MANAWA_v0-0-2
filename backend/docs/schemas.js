/**
 * MANAWA API Reusable Schemas
 * Centralized schema definitions for OpenAPI documentation
 *
 * Schemas are organized by entity:
 * - Authentication
 * - User Management
 * - Professional Services
 * - Projects & Quotes
 * - Bookings & Payments
 * - Messaging
 * - Admin & System
 * - Error Responses
 */

module.exports = {
  // ==================== AUTHENTICATION ====================

  AuthCredentials: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'User email address',
        example: 'user@example.com',
      },
      password: {
        type: 'string',
        description: 'User password (min 8 characters)',
        minLength: 8,
        example: 'SecurePassword123!',
      },
    },
  },

  RegistrationPayload: {
    type: 'object',
    required: ['email', 'password', 'firstName', 'lastName', 'role'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'user@example.com',
      },
      password: {
        type: 'string',
        minLength: 8,
        example: 'SecurePassword123!',
      },
      firstName: {
        type: 'string',
        minLength: 2,
        maxLength: 50,
        example: 'Jean',
      },
      lastName: {
        type: 'string',
        minLength: 2,
        maxLength: 50,
        example: 'Dupont',
      },
      phone: {
        type: 'string',
        nullable: true,
        example: '+33612345678',
      },
      city: {
        type: 'string',
        nullable: true,
        example: 'Paris',
      },
      role: {
        type: 'string',
        enum: ['CLIENT', 'PROFESSIONAL'],
        description: 'User account type',
      },
      trades: {
        type: 'array',
        items: { type: 'string' },
        nullable: true,
        description: 'Only for PROFESSIONAL role - max 3 trades',
        example: ['Plomberie', 'Chauffage'],
      },
      accountType: {
        type: 'string',
        enum: ['INDEPENDENT', 'ENTREPRISE', 'MICRO'],
        nullable: true,
        description: 'Business type for professionals',
      },
      companyName: {
        type: 'string',
        nullable: true,
        description: 'Company name for ENTREPRISE accounts',
        example: 'Plomberie Dupont SARL',
      },
    },
  },

  TokenRefreshPayload: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: {
        type: 'string',
        description: 'Valid refresh token from login or registration',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  },

  LogoutPayload: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: {
        type: 'string',
        description: 'Refresh token to invalidate',
      },
    },
  },

  // ==================== USER MANAGEMENT ====================

  UserProfile: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Unique user identifier',
      },
      email: {
        type: 'string',
        format: 'email',
        description: 'User email address',
      },
      firstName: {
        type: 'string',
        description: 'User first name',
      },
      lastName: {
        type: 'string',
        description: 'User last name',
      },
      phone: {
        type: 'string',
        nullable: true,
        description: 'User phone number',
      },
      city: {
        type: 'string',
        nullable: true,
        description: 'User city location',
      },
      role: {
        type: 'string',
        enum: ['CLIENT', 'PROFESSIONAL', 'ADMIN'],
        description: 'User role',
      },
      avatarUrl: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description: 'URL to user avatar image',
      },
      emailVerified: {
        type: 'boolean',
        description: 'Email verification status',
      },
      emailVerifiedAt: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description: 'Email verification timestamp',
      },
      accountStatus: {
        type: 'string',
        enum: ['ACTIVE', 'SUSPENDED', 'DELETED'],
        description: 'Account status',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        description: 'Account creation date',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
        description: 'Last profile update',
      },
    },
    required: ['id', 'email', 'firstName', 'lastName', 'role'],
  },

  UserProfileUpdate: {
    type: 'object',
    properties: {
      firstName: {
        type: 'string',
        minLength: 2,
        maxLength: 50,
      },
      lastName: {
        type: 'string',
        minLength: 2,
        maxLength: 50,
      },
      phone: {
        type: 'string',
        nullable: true,
      },
      city: {
        type: 'string',
        nullable: true,
      },
      avatarUrl: {
        type: 'string',
        format: 'uri',
        nullable: true,
      },
    },
  },

  PasswordChange: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: {
        type: 'string',
        description: 'Current password for verification',
      },
      newPassword: {
        type: 'string',
        minLength: 8,
        description: 'New password (min 8 characters)',
      },
    },
  },

  // ==================== PROFESSIONAL SERVICES ====================

  ProfessionalProfile: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      userId: {
        type: 'string',
        format: 'uuid',
        description: 'Associated user ID',
      },
      trade: {
        type: 'string',
        description: 'Primary trade (e.g., Plomberie, Électricité)',
        example: 'Plomberie',
      },
      trades: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of trade specialties (max 3)',
        example: ['Plomberie', 'Chauffage'],
      },
      accountType: {
        type: 'string',
        enum: ['INDEPENDENT', 'ENTREPRISE', 'MICRO'],
        description: 'Business account type',
      },
      companyName: {
        type: 'string',
        nullable: true,
        description: 'Company name for business accounts',
      },
      siret: {
        type: 'string',
        nullable: true,
        description: 'SIRET number (French business ID)',
        example: '12345678901234',
      },
      bio: {
        type: 'string',
        nullable: true,
        maxLength: 500,
        description: 'Professional biography',
      },
      yearsExperience: {
        type: 'integer',
        nullable: true,
        description: 'Years of experience in trade',
      },
      rating: {
        type: 'number',
        format: 'float',
        minimum: 0,
        maximum: 5,
        nullable: true,
        description: 'Average rating from reviews',
      },
      ratingCount: {
        type: 'integer',
        description: 'Total number of ratings',
      },
      responseTime: {
        type: 'string',
        nullable: true,
        description: 'Average response time',
        example: '2h',
      },
      acceptanceRate: {
        type: 'number',
        format: 'float',
        nullable: true,
        description: 'Percentage of accepted quotes',
      },
      portfolio: {
        type: 'array',
        items: { $ref: '#/components/schemas/PortfolioProject' },
        description: 'Portfolio of completed projects',
      },
      verified: {
        type: 'boolean',
        description: 'Whether professional is verified',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  ProfessionalProfileUpdate: {
    type: 'object',
    properties: {
      trade: {
        type: 'string',
      },
      trades: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
      },
      accountType: {
        type: 'string',
        enum: ['INDEPENDENT', 'ENTREPRISE', 'MICRO'],
      },
      companyName: {
        type: 'string',
        nullable: true,
      },
      siret: {
        type: 'string',
        nullable: true,
      },
      bio: {
        type: 'string',
        maxLength: 500,
        nullable: true,
      },
      yearsExperience: {
        type: 'integer',
        nullable: true,
      },
    },
  },

  // ==================== PROJECTS & QUOTES ====================

  ProjectCreatePayload: {
    type: 'object',
    required: ['title', 'description', 'category'],
    properties: {
      title: {
        type: 'string',
        minLength: 3,
        maxLength: 100,
        description: 'Project title',
        example: 'Rénovation salle de bain',
      },
      description: {
        type: 'string',
        minLength: 10,
        maxLength: 5000,
        description: 'Detailed project description',
      },
      category: {
        type: 'string',
        description: 'Project category',
        example: 'Plomberie',
      },
      budget: {
        type: 'number',
        format: 'float',
        minimum: 0,
        nullable: true,
        description: 'Project budget in EUR',
      },
      location: {
        type: 'string',
        nullable: true,
        description: 'Project location/address',
      },
      deadline: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'Project deadline',
      },
      urgent: {
        type: 'boolean',
        default: false,
        description: 'Mark as urgent',
      },
    },
  },

  Project: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      clientId: {
        type: 'string',
        format: 'uuid',
        description: 'Client user ID',
      },
      title: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      category: {
        type: 'string',
      },
      status: {
        type: 'string',
        enum: ['DRAFT', 'PUBLISHED', 'MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      },
      budget: {
        type: 'number',
        format: 'float',
        nullable: true,
      },
      location: {
        type: 'string',
        nullable: true,
      },
      deadline: {
        type: 'string',
        format: 'date',
        nullable: true,
      },
      photos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            uploadedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      quoteCount: {
        type: 'integer',
        description: 'Number of quotes received',
      },
      acceptedQuoteId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
      },
      review: {
        type: 'object',
        nullable: true,
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  QuoteCreatePayload: {
    type: 'object',
    required: ['projectId', 'title', 'amount'],
    properties: {
      projectId: {
        type: 'string',
        format: 'uuid',
      },
      title: {
        type: 'string',
        minLength: 3,
        maxLength: 100,
        description: 'Quote title',
      },
      description: {
        type: 'string',
        nullable: true,
        maxLength: 2000,
      },
      amount: {
        type: 'number',
        format: 'float',
        minimum: 0,
        description: 'Total quote amount (HT)',
      },
      tva: {
        type: 'number',
        format: 'float',
        nullable: true,
        description: 'VAT amount',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['description', 'quantity', 'unitPrice'],
          properties: {
            description: {
              type: 'string',
              description: 'Line item description',
            },
            quantity: {
              type: 'number',
              minimum: 0.01,
              description: 'Quantity',
            },
            unitPrice: {
              type: 'number',
              format: 'float',
              minimum: 0,
              description: 'Unit price HT',
            },
          },
        },
        description: 'Quote line items',
      },
      validUntil: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description: 'Quote expiration date',
      },
    },
  },

  Quote: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      projectId: {
        type: 'string',
        format: 'uuid',
      },
      professionalId: {
        type: 'string',
        format: 'uuid',
      },
      professional: {
        type: 'object',
        description: 'Professional details',
      },
      title: {
        type: 'string',
      },
      description: {
        type: 'string',
        nullable: true,
      },
      amount: {
        type: 'number',
        format: 'float',
      },
      tva: {
        type: 'number',
        format: 'float',
        nullable: true,
      },
      amountTTC: {
        type: 'number',
        format: 'float',
        description: 'Amount including VAT',
      },
      status: {
        type: 'string',
        enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'number' },
            unitPrice: { type: 'number', format: 'float' },
            subtotal: { type: 'number', format: 'float' },
          },
        },
      },
      validUntil: {
        type: 'string',
        format: 'date-time',
        nullable: true,
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== BOOKINGS & PAYMENTS ====================

  Booking: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      quoteId: {
        type: 'string',
        format: 'uuid',
      },
      quote: {
        type: 'object',
        description: 'Associated quote',
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      },
      scheduledDate: {
        type: 'string',
        format: 'date-time',
        description: 'Scheduled service date',
      },
      completedDate: {
        type: 'string',
        format: 'date-time',
        nullable: true,
      },
      notes: {
        type: 'string',
        nullable: true,
      },
      payments: {
        type: 'array',
        items: { type: 'object' },
        description: 'Associated payments',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  PaymentCreatePayload: {
    type: 'object',
    required: ['amount', 'method'],
    properties: {
      quoteId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
      },
      bookingId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
      },
      amount: {
        type: 'number',
        format: 'float',
        minimum: 0,
        description: 'Payment amount in EUR',
      },
      method: {
        type: 'string',
        enum: ['CARD', 'BANK_TRANSFER', 'WALLET'],
        description: 'Payment method',
      },
      isDeposit: {
        type: 'boolean',
        default: false,
        description: 'Whether this is a deposit',
      },
      description: {
        type: 'string',
        nullable: true,
        description: 'Payment description for user',
      },
    },
  },

  Payment: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      bookingId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
      },
      quoteId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
      },
      amount: {
        type: 'number',
        format: 'float',
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
      },
      method: {
        type: 'string',
        enum: ['CARD', 'BANK_TRANSFER', 'WALLET'],
      },
      geniuspayRef: {
        type: 'string',
        nullable: true,
        description: 'GeniusPay transaction reference',
      },
      isDeposit: {
        type: 'boolean',
      },
      failureReason: {
        type: 'string',
        nullable: true,
        description: 'Reason for payment failure',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== MESSAGING ====================

  Message: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      conversationId: {
        type: 'string',
        format: 'uuid',
      },
      senderId: {
        type: 'string',
        format: 'uuid',
      },
      recipientId: {
        type: 'string',
        format: 'uuid',
      },
      content: {
        type: 'string',
      },
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            type: { type: 'string', example: 'image/jpeg' },
          },
        },
      },
      read: {
        type: 'boolean',
      },
      readAt: {
        type: 'string',
        format: 'date-time',
        nullable: true,
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  Conversation: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      participantIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
      },
      lastMessage: {
        type: 'object',
        $ref: '#/components/schemas/Message',
        nullable: true,
      },
      unreadCount: {
        type: 'integer',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== REVIEWS & RATINGS ====================

  ReviewCreatePayload: {
    type: 'object',
    required: ['projectId', 'professionalId', 'rating'],
    properties: {
      projectId: {
        type: 'string',
        format: 'uuid',
      },
      professionalId: {
        type: 'string',
        format: 'uuid',
      },
      rating: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Rating from 1 to 5 stars',
      },
      comment: {
        type: 'string',
        nullable: true,
        maxLength: 500,
        description: 'Review comment',
      },
    },
  },

  Review: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      projectId: {
        type: 'string',
        format: 'uuid',
      },
      clientId: {
        type: 'string',
        format: 'uuid',
      },
      client: {
        type: 'object',
        description: 'Client user details',
      },
      professionalId: {
        type: 'string',
        format: 'uuid',
      },
      professional: {
        type: 'object',
        description: 'Professional details',
      },
      rating: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
      },
      comment: {
        type: 'string',
        nullable: true,
      },
      helpful: {
        type: 'integer',
        description: 'Number of helpful votes',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== PORTFOLIO ====================

  PortfolioProject: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      professionalId: {
        type: 'string',
        format: 'uuid',
      },
      title: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      category: {
        type: 'string',
      },
      photos: {
        type: 'array',
        items: {
          type: 'string',
          format: 'uri',
        },
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== NOTIFICATIONS ====================

  Notification: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      userId: {
        type: 'string',
        format: 'uuid',
      },
      type: {
        type: 'string',
        enum: ['QUOTE_RECEIVED', 'BOOKING_CONFIRMED', 'PAYMENT_RECEIVED', 'MESSAGE', 'REVIEW', 'SYSTEM'],
      },
      title: {
        type: 'string',
      },
      body: {
        type: 'string',
      },
      data: {
        type: 'object',
        nullable: true,
        description: 'Additional data specific to notification type',
      },
      read: {
        type: 'boolean',
      },
      readAt: {
        type: 'string',
        format: 'date-time',
        nullable: true,
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
      },
    },
  },

  // ==================== ERROR RESPONSES ====================

  ErrorResponse: {
    type: 'object',
    properties: {
      error: {
        type: 'string',
        description: 'Error message',
      },
      status: {
        type: 'integer',
        description: 'HTTP status code',
      },
      timestamp: {
        type: 'string',
        format: 'date-time',
        description: 'Error occurrence time',
      },
      path: {
        type: 'string',
        description: 'Request path that caused the error',
      },
    },
  },

  ValidationError: {
    type: 'object',
    properties: {
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name',
            },
            message: {
              type: 'string',
              description: 'Validation error message',
            },
            value: {
              description: 'Invalid value provided',
            },
          },
        },
      },
      message: {
        type: 'string',
        description: 'Overall validation error message',
      },
    },
  },

  // ==================== PAGINATION ====================

  PaginationMeta: {
    type: 'object',
    properties: {
      page: {
        type: 'integer',
        description: 'Current page number',
      },
      limit: {
        type: 'integer',
        description: 'Items per page',
      },
      total: {
        type: 'integer',
        description: 'Total items',
      },
      pages: {
        type: 'integer',
        description: 'Total pages',
      },
      hasNext: {
        type: 'boolean',
        description: 'Has more pages',
      },
      hasPrev: {
        type: 'boolean',
        description: 'Has previous pages',
      },
    },
  },

  PaginatedResponse: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { type: 'object' },
      },
      pagination: {
        $ref: '#/components/schemas/PaginationMeta',
      },
    },
  },
};
