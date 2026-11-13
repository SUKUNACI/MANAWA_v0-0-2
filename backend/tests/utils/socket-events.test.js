'use strict';

/**
 * Tests pour utils/socket-events.js
 * Définitions des événements Socket.IO, patterns de rooms, schémas de payloads et rate limits
 */

const {
  SOCKET_EVENTS,
  ROOM_PATTERNS,
  PAYLOAD_SCHEMAS,
  RATE_LIMITS,
} = require('../../utils/socket-events');

// ─── SOCKET_EVENTS ────────────────────────────────────────────────────────────

describe('SOCKET_EVENTS — structure', () => {
  it('exporte un objet non-vide', () => {
    expect(typeof SOCKET_EVENTS).toBe('object');
    expect(Object.keys(SOCKET_EVENTS).length).toBeGreaterThan(0);
  });

  it('toutes les valeurs sont des chaînes non vides', () => {
    Object.entries(SOCKET_EVENTS).forEach(([key, value]) => {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    });
  });
});

describe('SOCKET_EVENTS — événements booking', () => {
  it('définit BOOKING_UPDATE', () => {
    expect(SOCKET_EVENTS.BOOKING_UPDATE).toBe('booking.update');
  });

  it('définit BOOKING_CONFIRM', () => {
    expect(SOCKET_EVENTS.BOOKING_CONFIRM).toBe('booking.confirm');
  });

  it('définit BOOKING_CANCEL', () => {
    expect(SOCKET_EVENTS.BOOKING_CANCEL).toBe('booking.cancel');
  });

  it('définit BOOKING_COMPLETED', () => {
    expect(SOCKET_EVENTS.BOOKING_COMPLETED).toBe('booking.completed');
  });
});

describe('SOCKET_EVENTS — événements messaging', () => {
  it('définit MESSAGE_NEW', () => {
    expect(SOCKET_EVENTS.MESSAGE_NEW).toBe('message.new');
  });

  it('définit MESSAGE_TYPING', () => {
    expect(SOCKET_EVENTS.MESSAGE_TYPING).toBe('message.typing');
  });

  it('définit MESSAGE_SEEN', () => {
    expect(SOCKET_EVENTS.MESSAGE_SEEN).toBe('message.seen');
  });

  it('définit MESSAGE_DELIVERED', () => {
    expect(SOCKET_EVENTS.MESSAGE_DELIVERED).toBe('message.delivered');
  });
});

describe('SOCKET_EVENTS — événements notification', () => {
  it('définit NOTIFICATION_PUSH', () => {
    expect(SOCKET_EVENTS.NOTIFICATION_PUSH).toBe('notification.push');
  });

  it('définit NOTIFICATION_READ', () => {
    expect(SOCKET_EVENTS.NOTIFICATION_READ).toBe('notification.read');
  });

  it('définit NOTIFICATION_CLEAR', () => {
    expect(SOCKET_EVENTS.NOTIFICATION_CLEAR).toBe('notification.clear');
  });
});

describe('SOCKET_EVENTS — événements présence', () => {
  it('définit USER_ONLINE', () => {
    expect(SOCKET_EVENTS.USER_ONLINE).toBe('user.online');
  });

  it('définit USER_OFFLINE', () => {
    expect(SOCKET_EVENTS.USER_OFFLINE).toBe('user.offline');
  });

  it('définit USER_TYPING', () => {
    expect(SOCKET_EVENTS.USER_TYPING).toBe('user.typing');
  });

  it('définit USER_STOPPED_TYPING', () => {
    expect(SOCKET_EVENTS.USER_STOPPED_TYPING).toBe('user.stopped_typing');
  });
});

describe('SOCKET_EVENTS — événements paiement', () => {
  it('définit PAYMENT_STATUS', () => {
    expect(SOCKET_EVENTS.PAYMENT_STATUS).toBe('payment.status');
  });

  it('définit PAYMENT_PENDING', () => {
    expect(SOCKET_EVENTS.PAYMENT_PENDING).toBe('payment.pending');
  });

  it('définit PAYMENT_SUCCESS', () => {
    expect(SOCKET_EVENTS.PAYMENT_SUCCESS).toBe('payment.success');
  });

  it('définit PAYMENT_FAILED', () => {
    expect(SOCKET_EVENTS.PAYMENT_FAILED).toBe('payment.failed');
  });
});

describe('SOCKET_EVENTS — événements système', () => {
  it('définit CONNECT', () => {
    expect(SOCKET_EVENTS.CONNECT).toBe('connect');
  });

  it('définit DISCONNECT', () => {
    expect(SOCKET_EVENTS.DISCONNECT).toBe('disconnect');
  });

  it('définit ERROR', () => {
    expect(SOCKET_EVENTS.ERROR).toBe('error');
  });
});

// ─── ROOM_PATTERNS ────────────────────────────────────────────────────────────

describe('ROOM_PATTERNS — USER_ROOM', () => {
  it('génère un nom de room avec l\'userId', () => {
    expect(ROOM_PATTERNS.USER_ROOM('user-123')).toBe('user:user-123');
  });

  it('fonctionne avec un ID numérique converti en chaîne', () => {
    expect(ROOM_PATTERNS.USER_ROOM(42)).toBe('user:42');
  });
});

describe('ROOM_PATTERNS — BOOKING_ROOM', () => {
  it('génère un nom de room avec le bookingId', () => {
    expect(ROOM_PATTERNS.BOOKING_ROOM('booking-abc')).toBe('booking:booking-abc');
  });
});

describe('ROOM_PATTERNS — CONVERSATION_ROOM', () => {
  it('génère un nom de room avec le conversationId', () => {
    expect(ROOM_PATTERNS.CONVERSATION_ROOM('conv-xyz')).toBe('conversation:conv-xyz');
  });
});

describe('ROOM_PATTERNS — NOTIFICATION_ROOM', () => {
  it('génère un nom de room avec l\'userId', () => {
    expect(ROOM_PATTERNS.NOTIFICATION_ROOM('user-456')).toBe('notifications:user-456');
  });
});

describe('ROOM_PATTERNS — PRESENCE_ROOM', () => {
  it('retourne la room de présence globale', () => {
    expect(ROOM_PATTERNS.PRESENCE_ROOM()).toBe('presence:global');
  });

  it('retourne toujours la même valeur', () => {
    expect(ROOM_PATTERNS.PRESENCE_ROOM()).toBe(ROOM_PATTERNS.PRESENCE_ROOM());
  });
});

// ─── PAYLOAD_SCHEMAS ──────────────────────────────────────────────────────────

describe('PAYLOAD_SCHEMAS — structure générale', () => {
  it('exporte un objet non-vide', () => {
    expect(typeof PAYLOAD_SCHEMAS).toBe('object');
    expect(Object.keys(PAYLOAD_SCHEMAS).length).toBeGreaterThan(0);
  });
});

describe('PAYLOAD_SCHEMAS — MESSAGE', () => {
  it('définit les champs requis avec leur type', () => {
    const schema = PAYLOAD_SCHEMAS.MESSAGE;
    expect(schema).toBeDefined();
    expect(schema.conversationId).toBe('string');
    expect(schema.senderId).toBe('string');
    expect(schema.text).toBe('string');
    expect(schema.timestamp).toBe('number');
  });
});

describe('PAYLOAD_SCHEMAS — BOOKING', () => {
  it('définit les champs booking', () => {
    const schema = PAYLOAD_SCHEMAS.BOOKING;
    expect(schema.bookingId).toBe('string');
    expect(schema.status).toBe('string');
    expect(schema.metadata).toBe('object');
  });
});

describe('PAYLOAD_SCHEMAS — NOTIFICATION', () => {
  it('définit les champs notification', () => {
    const schema = PAYLOAD_SCHEMAS.NOTIFICATION;
    expect(schema.userId).toBe('string');
    expect(schema.type).toBe('string');
    expect(schema.title).toBe('string');
    expect(schema.message).toBe('string');
  });
});

describe('PAYLOAD_SCHEMAS — TYPING', () => {
  it('définit les champs typing', () => {
    const schema = PAYLOAD_SCHEMAS.TYPING;
    expect(schema.conversationId).toBe('string');
    expect(schema.userId).toBe('string');
    expect(schema.isTyping).toBe('boolean');
  });
});

describe('PAYLOAD_SCHEMAS — PAYMENT', () => {
  it('définit les champs payment', () => {
    const schema = PAYLOAD_SCHEMAS.PAYMENT;
    expect(schema.paymentId).toBe('string');
    expect(schema.status).toBe('string');
    expect(schema.amount).toBe('number');
  });
});

// ─── RATE_LIMITS ──────────────────────────────────────────────────────────────

describe('RATE_LIMITS — structure générale', () => {
  it('exporte un objet non-vide', () => {
    expect(typeof RATE_LIMITS).toBe('object');
    expect(Object.keys(RATE_LIMITS).length).toBeGreaterThan(0);
  });

  it('chaque entrée a max et windowMs', () => {
    Object.entries(RATE_LIMITS).forEach(([, config]) => {
      expect(typeof config.max).toBe('number');
      expect(config.max).toBeGreaterThan(0);
      expect(typeof config.windowMs).toBe('number');
      expect(config.windowMs).toBeGreaterThan(0);
    });
  });
});

describe('RATE_LIMITS — valeurs spécifiques', () => {
  it('MESSAGE_NEW : 60 messages par minute', () => {
    expect(RATE_LIMITS.MESSAGE_NEW.max).toBe(60);
    expect(RATE_LIMITS.MESSAGE_NEW.windowMs).toBe(60000);
  });

  it('MESSAGE_TYPING : 100 événements par minute', () => {
    expect(RATE_LIMITS.MESSAGE_TYPING.max).toBe(100);
    expect(RATE_LIMITS.MESSAGE_TYPING.windowMs).toBe(60000);
  });

  it('NOTIFICATION_PUSH : 200 notifications par minute', () => {
    expect(RATE_LIMITS.NOTIFICATION_PUSH.max).toBe(200);
    expect(RATE_LIMITS.NOTIFICATION_PUSH.windowMs).toBe(60000);
  });

  it('USER_TYPING : 100 événements par minute', () => {
    expect(RATE_LIMITS.USER_TYPING.max).toBe(100);
    expect(RATE_LIMITS.USER_TYPING.windowMs).toBe(60000);
  });
});
