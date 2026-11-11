/**
 * Webhook Trigger Integration Points
 *
 * This file documents where webhooks should be triggered in the application.
 * Each integration point shows the event type and the payload structure.
 *
 * Usage: Import and call the appropriate trigger function after the database operation completes.
 */

const { triggerWebhook, WEBHOOK_EVENTS } = require('./webhooks');

/**
 * BOOKING EVENTS
 */

/**
 * Trigger when a booking is created
 * Add to: routes/bookings.js - POST /bookings
 * After: await prisma.booking.create(...)
 *
 * @param {Object} booking - Booking object from database
 * @param {Object} client - Client user object
 * @param {Object} professional - Professional user object
 */
async function triggerBookingCreated(booking, client, professional) {
  await triggerWebhook(WEBHOOK_EVENTS.BOOKING_CREATED, {
    event: WEBHOOK_EVENTS.BOOKING_CREATED,
    timestamp: new Date().toISOString(),
    data: {
      bookingId: booking.id,
      professionalId: booking.professionalId,
      clientId: booking.clientId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      projectId: booking.projectId,
      createdAt: booking.createdAt,
      client: {
        id: client.id,
        email: client.email,
        firstName: client.firstName,
        lastName: client.lastName,
      },
      professional: {
        id: professional.id,
        email: professional.email,
        firstName: professional.firstName,
        lastName: professional.lastName,
      },
    },
  });
}

/**
 * Trigger when a booking status is updated
 * Add to: routes/bookings.js - PATCH /bookings/:id
 * After: await prisma.booking.update(...)
 */
async function triggerBookingUpdated(booking, client, professional, oldStatus) {
  await triggerWebhook(WEBHOOK_EVENTS.BOOKING_UPDATED, {
    event: WEBHOOK_EVENTS.BOOKING_UPDATED,
    timestamp: new Date().toISOString(),
    data: {
      bookingId: booking.id,
      professionalId: booking.professionalId,
      clientId: booking.clientId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      oldStatus,
      newStatus: booking.status,
      updatedAt: booking.updatedAt,
      client: {
        id: client.id,
        email: client.email,
      },
      professional: {
        id: professional.id,
        email: professional.email,
      },
    },
  });
}

/**
 * Trigger when a booking is cancelled
 * Add to: routes/bookings.js - DELETE /bookings/:id
 * After: await prisma.booking.delete(...)
 */
async function triggerBookingCancelled(booking, client, professional, reason) {
  await triggerWebhook(WEBHOOK_EVENTS.BOOKING_CANCELLED, {
    event: WEBHOOK_EVENTS.BOOKING_CANCELLED,
    timestamp: new Date().toISOString(),
    data: {
      bookingId: booking.id,
      professionalId: booking.professionalId,
      clientId: booking.clientId,
      cancelledAt: new Date().toISOString(),
      cancelReason: reason,
      originalStatus: booking.status,
      client: {
        id: client.id,
        email: client.email,
      },
      professional: {
        id: professional.id,
        email: professional.email,
      },
    },
  });
}

/**
 * PAYMENT EVENTS
 */

/**
 * Trigger when a payment succeeds
 * Add to: routes/finances.js or payment handler
 * After: Payment status changes to 'succeeded'
 */
async function triggerPaymentCompleted(payment, quote, professional, client) {
  await triggerWebhook(WEBHOOK_EVENTS.PAYMENT_COMPLETED, {
    event: WEBHOOK_EVENTS.PAYMENT_COMPLETED,
    timestamp: new Date().toISOString(),
    data: {
      paymentId: payment.id,
      quoteId: payment.quoteId,
      amount: payment.amount,
      netAmount: payment.netAmount,
      fees: payment.fees,
      status: payment.status,
      method: payment.paymentMethod,
      completedAt: payment.completedAt,
      isDeposit: payment.isDeposit,
      quote: {
        id: quote.id,
        amount: quote.amount,
        description: quote.description,
      },
      professional: {
        id: professional.id,
        email: professional.email,
        firstName: professional.firstName,
        lastName: professional.lastName,
      },
      client: {
        id: client.id,
        email: client.email,
        firstName: client.firstName,
        lastName: client.lastName,
      },
    },
  });
}

/**
 * Trigger when a payment fails
 * Add to: payment processing handler
 * After: Payment status changes to 'failed'
 */
async function triggerPaymentFailed(payment, quote, professional, client, failureReason) {
  await triggerWebhook(WEBHOOK_EVENTS.PAYMENT_FAILED, {
    event: WEBHOOK_EVENTS.PAYMENT_FAILED,
    timestamp: new Date().toISOString(),
    data: {
      paymentId: payment.id,
      quoteId: payment.quoteId,
      amount: payment.amount,
      status: payment.status,
      failureReason,
      failedAt: new Date().toISOString(),
      quote: {
        id: quote.id,
        amount: quote.amount,
      },
      professional: {
        id: professional.id,
        email: professional.email,
      },
      client: {
        id: client.id,
        email: client.email,
      },
    },
  });
}

/**
 * QUOTE EVENTS
 */

/**
 * Trigger when a quote is created
 * Add to: routes/quotes.js - POST /quotes
 * After: await prisma.quote.create(...)
 */
async function triggerQuoteCreated(quote, professional, project, client) {
  await triggerWebhook(WEBHOOK_EVENTS.QUOTE_CREATED, {
    event: WEBHOOK_EVENTS.QUOTE_CREATED,
    timestamp: new Date().toISOString(),
    data: {
      quoteId: quote.id,
      projectId: quote.projectId,
      professionalId: quote.professionalId,
      amount: quote.amount,
      description: quote.description,
      status: quote.status,
      expiresAt: quote.expiresAt,
      mode: quote.mode,
      createdAt: quote.createdAt,
      professional: {
        id: professional.id,
        email: professional.email,
        firstName: professional.firstName,
        lastName: professional.lastName,
        trade: professional.trade,
      },
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        budget: {
          min: project.budgetMin,
          max: project.budgetMax,
        },
      },
      client: {
        id: client.id,
        email: client.email,
        firstName: client.firstName,
        lastName: client.lastName,
      },
    },
  });
}

/**
 * Trigger when a quote is accepted
 * Add to: routes/quotes.js - PATCH /quotes/:id/accept
 * After: Quote status changes to 'ACCEPTED'
 */
async function triggerQuoteAccepted(quote, professional, project, client) {
  await triggerWebhook(WEBHOOK_EVENTS.QUOTE_ACCEPTED, {
    event: WEBHOOK_EVENTS.QUOTE_ACCEPTED,
    timestamp: new Date().toISOString(),
    data: {
      quoteId: quote.id,
      projectId: quote.projectId,
      professionalId: quote.professionalId,
      amount: quote.amount,
      acceptedAt: new Date().toISOString(),
      professional: {
        id: professional.id,
        email: professional.email,
        firstName: professional.firstName,
        lastName: professional.lastName,
      },
      project: {
        id: project.id,
        title: project.title,
      },
      client: {
        id: client.id,
        email: client.email,
      },
    },
  });
}

/**
 * Trigger when a quote is refused
 * Add to: routes/quotes.js - PATCH /quotes/:id/refuse
 * After: Quote status changes to 'REFUSED'
 */
async function triggerQuoteRefused(quote, professional, project, client) {
  await triggerWebhook(WEBHOOK_EVENTS.QUOTE_REFUSED, {
    event: WEBHOOK_EVENTS.QUOTE_REFUSED,
    timestamp: new Date().toISOString(),
    data: {
      quoteId: quote.id,
      projectId: quote.projectId,
      professionalId: quote.professionalId,
      amount: quote.amount,
      refusedAt: new Date().toISOString(),
      professional: {
        id: professional.id,
        email: professional.email,
      },
      project: {
        id: project.id,
        title: project.title,
      },
      client: {
        id: client.id,
        email: client.email,
      },
    },
  });
}

/**
 * USER EVENTS
 */

/**
 * Trigger when a user registers
 * Add to: routes/auth.js - POST /auth/register
 * After: await prisma.user.create(...)
 */
async function triggerUserRegistered(user) {
  await triggerWebhook(WEBHOOK_EVENTS.USER_REGISTERED, {
    event: WEBHOOK_EVENTS.USER_REGISTERED,
    timestamp: new Date().toISOString(),
    data: {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      phone: user.phone,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
  });
}

/**
 * Trigger when a user email is verified
 * Add to: routes/auth.js - POST /auth/verify-email
 * After: User emailVerified = true is confirmed
 */
async function triggerUserVerified(user) {
  await triggerWebhook(WEBHOOK_EVENTS.USER_VERIFIED, {
    event: WEBHOOK_EVENTS.USER_VERIFIED,
    timestamp: new Date().toISOString(),
    data: {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      verifiedAt: new Date().toISOString(),
    },
  });
}

/**
 * PROJECT EVENTS
 */

/**
 * Trigger when a project is created
 * Add to: routes/projects.js - POST /projects
 * After: await prisma.project.create(...)
 */
async function triggerProjectCreated(project, client) {
  await triggerWebhook(WEBHOOK_EVENTS.PROJECT_CREATED, {
    event: WEBHOOK_EVENTS.PROJECT_CREATED,
    timestamp: new Date().toISOString(),
    data: {
      projectId: project.id,
      clientId: project.clientId,
      title: project.title,
      description: project.description,
      tradeNeeded: project.tradeNeeded,
      budget: {
        min: project.budgetMin,
        max: project.budgetMax,
      },
      location: {
        city: project.city,
        latitude: project.latitude,
        longitude: project.longitude,
      },
      status: project.status,
      createdAt: project.createdAt,
      client: {
        id: client.id,
        email: client.email,
        firstName: client.firstName,
        lastName: client.lastName,
        city: client.city,
      },
    },
  });
}

/**
 * Trigger when a project is completed
 * Add to: routes/projects.js - PATCH /projects/:id/complete
 * After: Project status changes to 'COMPLETED'
 */
async function triggerProjectCompleted(project, client) {
  await triggerWebhook(WEBHOOK_EVENTS.PROJECT_COMPLETED, {
    event: WEBHOOK_EVENTS.PROJECT_COMPLETED,
    timestamp: new Date().toISOString(),
    data: {
      projectId: project.id,
      clientId: project.clientId,
      title: project.title,
      completedAt: new Date().toISOString(),
      status: project.status,
      clientConfirmedCompletion: project.clientConfirmedCompletion,
      proConfirmedCompletion: project.proConfirmedCompletion,
      client: {
        id: client.id,
        email: client.email,
      },
    },
  });
}

module.exports = {
  // Booking triggers
  triggerBookingCreated,
  triggerBookingUpdated,
  triggerBookingCancelled,

  // Payment triggers
  triggerPaymentCompleted,
  triggerPaymentFailed,

  // Quote triggers
  triggerQuoteCreated,
  triggerQuoteAccepted,
  triggerQuoteRefused,

  // User triggers
  triggerUserRegistered,
  triggerUserVerified,

  // Project triggers
  triggerProjectCreated,
  triggerProjectCompleted,
};
