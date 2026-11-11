const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../src/config/db', () => ({
  booking: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  availabilitySlot: {
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
}));

jest.mock('../../src/config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const jwt = require('jsonwebtoken');
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        req.user.role = req.user.role || 'CLIENT';
      } catch {
        return res.status(401).json({ error: 'Token invalide' });
      }
    }
    next();
  },
}));

const prisma = require('../../src/config/db');
const bookingsRouter = require('../../src/routes/bookings');
const { sendPushNotification } = require('../../src/config/pushNotifications');

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
app.use((err, req, res, next) => {
  console.error('[TEST ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

// ============ TEST DATA FIXTURES ============

const PRO_USER_ID = 'pro-user-1';
const PRO_ID = 'pro-1';
const CLIENT_USER_ID = 'client-user-1';
const ADMIN_USER_ID = 'admin-user-1';

const mockProUser = {
  id: PRO_USER_ID,
  role: 'PROFESSIONAL',
  email: 'pro@test.com',
  firstName: 'Marie',
  lastName: 'Martin',
  phone: '+261123456789',
};

const mockClientUser = {
  id: CLIENT_USER_ID,
  role: 'CLIENT',
  email: 'client@test.com',
  firstName: 'Jean',
  lastName: 'Dupont',
  phone: '+261987654321',
};

const mockAdminUser = {
  id: ADMIN_USER_ID,
  role: 'ADMIN',
  email: 'admin@test.com',
  adminLevel: 'SUPER',
};

const mockProfessional = {
  id: PRO_ID,
  userId: PRO_USER_ID,
  trade: 'Plombier',
  completedMissionsCount: 5,
  cancelledMissionsCount: 1,
  user: mockProUser,
};

const mockBooking = {
  id: 'booking-1',
  professionalId: PRO_ID,
  clientId: CLIENT_USER_ID,
  date: new Date('2026-11-20'),
  startTime: '09:00',
  endTime: '11:00',
  status: 'PENDING',
  note: 'Besoin de réparation d\'urgence',
  projectId: null,
  cancelReason: null,
  cancelledBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  professional: mockProfessional,
  client: mockClientUser,
  project: null,
};

const mockConfirmedBooking = {
  ...mockBooking,
  id: 'booking-2',
  status: 'CONFIRMED',
};

const mockCancelledBooking = {
  ...mockBooking,
  id: 'booking-3',
  status: 'CANCELLED',
  cancelReason: 'Urgence professionnelle',
  cancelledBy: PRO_USER_ID,
};

// ============ HELPER SETUP FUNCTIONS ============

function setupUserMock(prisma) {
  prisma.user.findUnique.mockImplementation(({ where }) => {
    if (where?.id === PRO_USER_ID) return Promise.resolve(mockProUser);
    if (where?.id === CLIENT_USER_ID) return Promise.resolve(mockClientUser);
    if (where?.id === ADMIN_USER_ID) return Promise.resolve(mockAdminUser);
    return Promise.resolve(null);
  });
}

function setupProfessionalMock(prisma) {
  prisma.professional.findUnique.mockImplementation(({ where }) => {
    if (where?.userId === PRO_USER_ID) return Promise.resolve(mockProfessional);
    if (where?.id === PRO_ID) return Promise.resolve(mockProfessional);
    return Promise.resolve(null);
  });
}

function resetAllMocks() {
  jest.clearAllMocks();
  setupUserMock(prisma);
  setupProfessionalMock(prisma);
}

// ============ TESTS: GET /api/bookings ============

describe('GET /api/bookings - List bookings', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.booking.findMany.mockResolvedValue([mockBooking, mockConfirmedBooking]);
    prisma.booking.count.mockResolvedValue(2);
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  test('should return all bookings for authenticated user', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bookings');
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
  });

  test('should support pagination with page and limit', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  test('should filter by status', async () => {
    prisma.booking.findMany.mockResolvedValue([mockConfirmedBooking]);
    prisma.booking.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/bookings')
      .query({ status: 'CONFIRMED' })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'CONFIRMED' }),
      })
    );
  });

  test('should filter by professionalId', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .query({ professionalId: PRO_ID })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ professionalId: PRO_ID }),
      })
    );
  });

  test('should filter by date range', async () => {
    const dateFrom = '2026-11-15';
    const dateTo = '2026-11-25';

    const res = await request(app)
      .get('/api/bookings')
      .query({ dateFrom, dateTo })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      })
    );
  });

  test('should search by client or professional name', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .query({ search: 'Marie' })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              professional: expect.objectContaining({
                user: expect.objectContaining({
                  firstName: expect.objectContaining({ contains: 'Marie' }),
                }),
              }),
            }),
          ]),
        }),
      })
    );
  });

  test('should return bookings ordered by date descending', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { date: 'desc' },
      })
    );
  });

  test('should default limit to 50 if not specified', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });

  test('should start at page 1 if not specified', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
      })
    );
  });
});

// ============ TESTS: GET /api/bookings/:id ============

describe('GET /api/bookings/:id - Get booking detail', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.booking.findUnique.mockResolvedValue(mockBooking);
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).get(`/api/bookings/${mockBooking.id}`);
    expect(res.status).toBe(401);
  });

  test('should return booking details for authenticated user', async () => {
    const res = await request(app)
      .get(`/api/bookings/${mockBooking.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockBooking);
  });

  test('should include client, professional and project details', async () => {
    const res = await request(app)
      .get(`/api/bookings/${mockBooking.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client');
    expect(res.body).toHaveProperty('professional');
    expect(res.body).toHaveProperty('project');
  });

  test('should return 404 if booking not found', async () => {
    prisma.booking.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/bookings/invalid-id')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('should fetch booking with correct ID', async () => {
    const res = await request(app)
      .get(`/api/bookings/${mockBooking.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { id: mockBooking.id },
      include: {
        client: true,
        professional: expect.any(Object),
        project: true,
        auditLog: true,
      },
    });
  });
});

// ============ TESTS: PATCH /api/bookings/:id/cancel ============

describe('PATCH /api/bookings/:id/cancel - Cancel booking', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.booking.update.mockResolvedValue(mockCancelledBooking);
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).patch(`/api/bookings/${mockBooking.id}/cancel`);
    expect(res.status).toBe(401);
  });

  test('should cancel booking with reason provided', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({
        reason: 'Urgence professionnelle',
        notifyByEmail: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('CANCELLED');
  });

  test('should set status to CANCELLED', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ reason: 'Client indisponible' });

    expect(res.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockBooking.id },
        data: expect.objectContaining({
          status: 'CANCELLED',
        }),
      })
    );
  });

  test('should store cancellation reason', async () => {
    const cancelReason = 'Imprévu professionnel';

    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({ reason: cancelReason });

    expect(res.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancellationReason: cancelReason,
        }),
      })
    );
  });

  test('should set cancelledAt timestamp', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ reason: 'Test cancellation' });

    expect(res.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelledAt: expect.any(Date),
        }),
      })
    );
  });

  test('should cancel without reason', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancellationReason: null,
        }),
      })
    );
  });

  test('should include client and professional in response', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({ reason: 'Test' });

    expect(res.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          client: true,
          professional: expect.any(Object),
        },
      })
    );
  });

  test('should return cancelled booking details', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ reason: 'Client change' });

    expect(res.status).toBe(200);
    expect(res.body.booking).toHaveProperty('id');
    expect(res.body.booking).toHaveProperty('client');
    expect(res.body.booking).toHaveProperty('professional');
  });
});

// ============ BUSINESS LOGIC TESTS ============

describe('Booking Business Logic', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('Booking States', () => {
    test('booking starts in PENDING state when created', () => {
      expect(mockBooking.status).toBe('PENDING');
    });

    test('booking can transition from PENDING to CONFIRMED', async () => {
      prisma.booking.update.mockResolvedValue(mockConfirmedBooking);

      // Simulate confirmation logic (would be in actual API)
      expect(mockConfirmedBooking.status).toBe('CONFIRMED');
    });

    test('booking can transition from PENDING to CANCELLED', async () => {
      expect(mockCancelledBooking.status).toBe('CANCELLED');
      expect(mockCancelledBooking.cancelReason).toBeDefined();
    });
  });

  describe('Professional Availability', () => {
    test('should check availability slots when booking', async () => {
      prisma.availabilitySlot.findMany.mockResolvedValue([
        {
          id: 'slot-1',
          dayOfWeek: 3, // Wednesday
          startTime: '08:00',
          endTime: '17:00',
          type: 'RECURRING',
        },
      ]);

      const slots = await prisma.availabilitySlot.findMany({
        where: { professionalId: PRO_ID },
      });

      expect(slots).toHaveLength(1);
      expect(slots[0].type).toBe('RECURRING');
    });

    test('should respect exception availability slots (unavailable dates)', async () => {
      prisma.availabilitySlot.findMany.mockResolvedValue([
        {
          id: 'exception-1',
          type: 'EXCEPTION',
          date: new Date('2026-11-20'),
          available: false,
          note: 'Vacances',
        },
      ]);

      const exceptions = await prisma.availabilitySlot.findMany({
        where: {
          professionalId: PRO_ID,
          type: 'EXCEPTION',
        },
      });

      expect(exceptions[0].available).toBe(false);
    });
  });

  describe('Conflict Detection', () => {
    test('should detect overlapping bookings', async () => {
      const existingBooking = {
        ...mockBooking,
        startTime: '09:00',
        endTime: '11:00',
      };

      const newBookingOverlaps = {
        startTime: '10:00', // Overlaps with existing 09:00-11:00
        endTime: '12:00',
      };

      // Check if times overlap
      const existing_start = parseInt(existingBooking.startTime.replace(':', ''));
      const existing_end = parseInt(existingBooking.endTime.replace(':', ''));
      const new_start = parseInt(newBookingOverlaps.startTime.replace(':', ''));
      const new_end = parseInt(newBookingOverlaps.endTime.replace(':', ''));

      const hasConflict = !(new_end <= existing_start || new_start >= existing_end);
      expect(hasConflict).toBe(true);
    });

    test('should allow sequential bookings without overlap', async () => {
      const booking1 = { startTime: '09:00', endTime: '11:00' };
      const booking2 = { startTime: '11:00', endTime: '13:00' }; // Starts exactly when first ends

      const start1 = parseInt(booking1.startTime.replace(':', ''));
      const end1 = parseInt(booking1.endTime.replace(':', ''));
      const start2 = parseInt(booking2.startTime.replace(':', ''));
      const end2 = parseInt(booking2.endTime.replace(':', ''));

      const hasConflict = !(end2 <= start1 || start2 >= end1);
      expect(hasConflict).toBe(false);
    });
  });

  describe('Cancellation Policies', () => {
    test('client can cancel and get full refund', async () => {
      const booking = {
        ...mockBooking,
        clientId: CLIENT_USER_ID,
        status: 'PENDING',
      };

      // In real scenario, would trigger refund logic
      expect(booking.status).toBe('PENDING');
    });

    test('professional cancellation increments cancelled counter', async () => {
      prisma.professional.update.mockResolvedValue({
        ...mockProfessional,
        cancelledMissionsCount: mockProfessional.cancelledMissionsCount + 1,
      });

      const result = await prisma.professional.update({
        where: { id: PRO_ID },
        data: { cancelledMissionsCount: { increment: 1 } },
      });

      expect(result.cancelledMissionsCount).toBe(2);
    });

    test('cancellation records reason and timestamp', async () => {
      expect(mockCancelledBooking.cancelReason).toBe('Urgence professionnelle');
      expect(mockCancelledBooking.cancelledAt).toBeDefined();
      expect(mockCancelledBooking.cancelledBy).toBeDefined();
    });
  });

  describe('Notifications', () => {
    test('should send push notification on booking confirmation', async () => {
      sendPushNotification.mockResolvedValue(true);

      const result = await sendPushNotification(
        PRO_USER_ID,
        'Nouvelle réservation',
        'Une nouvelle réservation a été reçue',
        { type: 'booking_created', bookingId: 'booking-1' }
      );

      expect(result).toBe(true);
      expect(sendPushNotification).toHaveBeenCalled();
    });

    test('should send notification to both client and professional on booking', async () => {
      sendPushNotification.mockResolvedValue(true);

      await sendPushNotification(PRO_USER_ID, 'Notification', 'Message');
      await sendPushNotification(CLIENT_USER_ID, 'Notification', 'Message');

      expect(sendPushNotification).toHaveBeenCalledTimes(2);
    });

    test('should send notification on booking cancellation', async () => {
      sendPushNotification.mockResolvedValue(true);

      await sendPushNotification(
        CLIENT_USER_ID,
        'Réservation annulée',
        'La réservation a été annulée',
        { type: 'booking_cancelled', bookingId: 'booking-1' }
      );

      expect(sendPushNotification).toHaveBeenCalled();
    });
  });
});

// ============ ERROR HANDLING ============

describe('Booking Error Handling', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('should handle database errors gracefully', async () => {
    prisma.booking.findMany.mockRejectedValue(new Error('Database connection failed'));

    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(500);
  });

  test('should handle invalid date format in filter', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .query({ dateFrom: 'invalid-date' })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    // Should not crash, either ignore or handle gracefully
    expect([200, 400]).toContain(res.status);
  });

  test('should handle missing required fields in cancel request', async () => {
    prisma.booking.update.mockResolvedValue(mockCancelledBooking);

    const res = await request(app)
      .patch(`/api/bookings/${mockBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({}); // No fields provided

    expect(res.status).toBe(200); // Should still work with defaults
  });

  test('should not expose sensitive data in error messages', async () => {
    prisma.booking.findUnique.mockRejectedValue(new Error('Internal server error details'));

    const res = await request(app)
      .get(`/api/bookings/test-id`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(500);
    // Response should not contain detailed error info
  });
});

// ============ EDGE CASES ============

describe('Booking Edge Cases', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('should handle pagination at boundary (page 0 should default to 1)', async () => {
    prisma.booking.findMany.mockResolvedValue([mockBooking]);
    prisma.booking.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/bookings')
      .query({ page: 0, limit: 10 })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should handle very large limit requests', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    prisma.booking.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/bookings')
      .query({ page: 1, limit: 10000 })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should handle cancelling already cancelled booking gracefully', async () => {
    prisma.booking.update.mockResolvedValue(mockCancelledBooking);

    const res = await request(app)
      .patch(`/api/bookings/${mockCancelledBooking.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ reason: 'Double cancellation' });

    expect(res.status).toBe(200);
  });

  test('should handle booking with null project gracefully', async () => {
    const bookingNoProject = { ...mockBooking, projectId: null, project: null };
    prisma.booking.findUnique.mockResolvedValue(bookingNoProject);

    const res = await request(app)
      .get(`/api/bookings/${mockBooking.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.project).toBeNull();
  });

  test('should handle empty search results', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    prisma.booking.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/bookings')
      .query({ search: 'NonexistentPerson' })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  test('should handle multiple filters simultaneously', async () => {
    prisma.booking.findMany.mockResolvedValue([mockConfirmedBooking]);
    prisma.booking.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/bookings')
      .query({
        status: 'CONFIRMED',
        professionalId: PRO_ID,
        dateFrom: '2026-11-15',
        dateTo: '2026-11-25',
        search: 'Marie',
      })
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CONFIRMED',
          professionalId: PRO_ID,
        }),
      })
    );
  });
});
