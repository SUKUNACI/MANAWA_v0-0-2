/**
 * Swagger Configuration for MANAWA Backend API
 * OpenAPI 3.0 Specification
 *
 * This file defines the complete API documentation including:
 * - 337+ endpoints across 29 route modules
 * - Request/response schemas
 * - Authentication schemes (Bearer JWT)
 * - Error responses and rate limiting
 * - Entity relationships and examples
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MANAWA Backend API',
      version: '1.0.0',
      description: 'Complete API documentation for MANAWA - Platform de mise en relation particuliers/professionnels du bâtiment',
      contact: {
        name: 'MANAWA Support',
        email: 'support@manawa.app',
      },
      license: {
        name: 'Proprietary',
        url: 'https://manawa.app/license',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Development Server',
        variables: {
          port: {
            default: '3000',
          },
        },
      },
      {
        url: 'https://api.manawa.app',
        description: 'Production Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token. Obtain via /auth/login or /auth/register',
        },
      },
      schemas: {
        // User Schemas
        User: {
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
              description: 'User city',
            },
            role: {
              type: 'string',
              enum: ['CLIENT', 'PROFESSIONAL', 'ADMIN'],
              description: 'User role in the system',
            },
            avatarUrl: {
              type: 'string',
              format: 'uri',
              nullable: true,
              description: 'User avatar URL',
            },
            emailVerified: {
              type: 'boolean',
              description: 'Whether user email is verified',
            },
            emailVerifiedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Email verification timestamp',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp',
            },
          },
          required: ['id', 'email', 'firstName', 'lastName', 'role'],
        },
        Professional: {
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
            trade: {
              type: 'string',
              description: 'Primary trade/business category',
            },
            trades: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of trades the professional handles',
            },
            accountType: {
              type: 'string',
              enum: ['INDEPENDENT', 'ENTREPRISE', 'MICRO'],
              description: 'Business account type',
            },
            companyName: {
              type: 'string',
              nullable: true,
              description: 'Company name if applicable',
            },
            siret: {
              type: 'string',
              nullable: true,
              description: 'SIRET number for French businesses',
            },
            rating: {
              type: 'number',
              format: 'float',
              nullable: true,
              description: 'Average rating (0-5)',
            },
            ratingCount: {
              type: 'integer',
              description: 'Number of ratings',
            },
            portfolio: {
              type: 'array',
              items: { $ref: '#/components/schemas/PortfolioProject' },
              description: 'Portfolio projects',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
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
            },
            title: {
              type: 'string',
              description: 'Project title',
            },
            description: {
              type: 'string',
              description: 'Detailed project description',
            },
            category: {
              type: 'string',
              description: 'Project category (e.g., plomberie, électricité)',
            },
            status: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
              description: 'Current project status',
            },
            budget: {
              type: 'number',
              format: 'float',
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
              description: 'Project photos/images',
            },
            quotes: {
              type: 'array',
              items: { $ref: '#/components/schemas/Quote' },
              description: 'Associated quotes from professionals',
            },
            review: {
              $ref: '#/components/schemas/Review',
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
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            amount: {
              type: 'number',
              format: 'float',
              description: 'Quote total amount in EUR',
            },
            tva: {
              type: 'number',
              format: 'float',
              nullable: true,
              description: 'VAT amount',
            },
            status: {
              type: 'string',
              enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
              description: 'Quote status',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  subtotal: { type: 'number' },
                },
              },
              description: 'Line items in quote',
            },
            validUntil: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Quote expiration date',
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
            status: {
              type: 'string',
              enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
              description: 'Booking status',
            },
            scheduledDate: {
              type: 'string',
              format: 'date-time',
              description: 'Scheduled date/time for service',
            },
            completedDate: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Actual completion date',
            },
            notes: {
              type: 'string',
              nullable: true,
              description: 'Additional notes',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
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
              description: 'Payment amount in EUR',
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
              description: 'Payment status',
            },
            method: {
              type: 'string',
              enum: ['CARD', 'BANK_TRANSFER', 'WALLET'],
              description: 'Payment method',
            },
            geniuspayRef: {
              type: 'string',
              nullable: true,
              description: 'GeniusPay reference number',
            },
            isDeposit: {
              type: 'boolean',
              description: 'Whether this is a deposit payment',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
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
            professionalId: {
              type: 'string',
              format: 'uuid',
            },
            rating: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Rating from 1-5',
            },
            comment: {
              type: 'string',
              nullable: true,
              description: 'Review comment',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
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
              items: { type: 'string', format: 'uri' },
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
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
              description: 'Notification type',
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
              description: 'Additional notification data',
            },
            read: {
              type: 'boolean',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            user: {
              $ref: '#/components/schemas/User',
            },
            token: {
              type: 'string',
              description: 'JWT access token (15 minute expiration)',
            },
            refreshToken: {
              type: 'string',
              description: 'Refresh token (30 day expiration)',
            },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
              },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                pages: { type: 'integer' },
              },
            },
          },
        },
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
              description: 'Error timestamp',
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
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      responses: {
        // Common responses
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
              example: {
                error: 'Unauthorized',
                status: 401,
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
              example: {
                error: 'Forbidden - insufficient permissions',
                status: 403,
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
              example: {
                error: 'Resource not found',
                status: 404,
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ValidationError',
              },
            },
          },
        },
        RateLimitError: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
              example: {
                error: 'Too many requests, please retry in 15 minutes',
                status: 429,
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
              example: {
                error: 'Internal server error',
                status: 500,
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    './routes/*.js',
    './docs/api-endpoints.js',
  ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
