const NotificationsModule = require('../../modules/notifications');

describe('NotificationsModule', () => {
  let prisma;
  let notificationsModule;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    notificationsModule = new NotificationsModule(prisma);
  });

  describe('getTypes', () => {
    test('returns all notification types', () => {
      const types = notificationsModule.getTypes();

      expect(types.NEW_BOOKING).toBeDefined();
      expect(types.PAYMENT_RECEIVED).toBeDefined();
      expect(types.NEW_FOLLOWER).toBeDefined();
      expect(types.NEW_BOOKING.priority).toBe('high');
      expect(types.NEW_FOLLOWER.priority).toBe('low');
    });
  });

  describe('isValidType', () => {
    test('returns true for valid type', () => {
      expect(notificationsModule.isValidType('NEW_BOOKING')).toBe(true);
      expect(notificationsModule.isValidType('PAYMENT_RECEIVED')).toBe(true);
    });

    test('returns false for invalid type', () => {
      expect(notificationsModule.isValidType('INVALID_TYPE')).toBe(false);
      expect(notificationsModule.isValidType('random')).toBe(false);
    });
  });

  describe('sendNotification', () => {
    test('creates notification with valid type', async () => {
      const mockNotif = { id: 'notif-1', userId: 'user-1', type: 'NEW_BOOKING' };
      prisma.notification.create.mockResolvedValue(mockNotif);

      const result = await notificationsModule.sendNotification('NEW_BOOKING', {
        userId: 'user-1',
        data: { bookingId: 'booking-1' },
      });

      expect(result).toEqual(mockNotif);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            type: 'NEW_BOOKING',
          }),
        })
      );
    });

    test('throws error for invalid type', async () => {
      await expect(
        notificationsModule.sendNotification('INVALID_TYPE', { userId: 'user-1' })
      ).rejects.toThrow('Invalid notification type');
    });

    test('logs and throws on database error', async () => {
      prisma.notification.create.mockRejectedValue(new Error('DB error'));

      await expect(
        notificationsModule.sendNotification('NEW_BOOKING', { userId: 'user-1' })
      ).rejects.toThrow('DB error');
    });
  });

  describe('sendBatchNotifications', () => {
    test('creates multiple notifications with createMany', async () => {
      const notifications = [
        { userId: 'user-1', type: 'NEW_BOOKING', data: {} },
        { userId: 'user-2', type: 'PAYMENT_RECEIVED', data: {} },
      ];
      prisma.notification.createMany.mockResolvedValue({ count: 2 });

      const result = await notificationsModule.sendBatchNotifications(notifications);

      expect(result).toBe(2);
      expect(prisma.notification.createMany).toHaveBeenCalled();
      const callData = prisma.notification.createMany.mock.calls[0][0];
      expect(callData.data.length).toBe(2);
    });

    test('returns 0 for empty array', async () => {
      const result = await notificationsModule.sendBatchNotifications([]);

      expect(result).toBe(0);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    test('throws error for invalid type in batch', async () => {
      const notifications = [
        { userId: 'user-1', type: 'INVALID_TYPE', data: {} },
      ];

      await expect(
        notificationsModule.sendBatchNotifications(notifications)
      ).rejects.toThrow('Invalid notification type');
    });
  });

  describe('markAsRead', () => {
    test('marks notification as read', async () => {
      const mockNotif = { id: 'notif-1', read: true, readAt: new Date() };
      prisma.notification.update.mockResolvedValue(mockNotif);

      const result = await notificationsModule.markAsRead('notif-1');

      expect(result).toEqual(mockNotif);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({ read: true }),
        })
      );
    });
  });

  describe('markAllAsRead', () => {
    test('marks all user notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await notificationsModule.markAllAsRead('user-1');

      expect(result).toBe(5);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', read: false },
        })
      );
    });
  });

  describe('getUnreadCount', () => {
    test('returns unread notification count', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await notificationsModule.getUnreadCount('user-1');

      expect(result).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', read: false },
        })
      );
    });

    test('returns 0 on error', async () => {
      prisma.notification.count.mockRejectedValue(new Error('DB error'));

      const result = await notificationsModule.getUnreadCount('user-1');

      expect(result).toBe(0);
    });
  });

  describe('getRecent', () => {
    test('returns recent notifications', async () => {
      const mockNotifs = [
        { id: 'notif-1', type: 'NEW_BOOKING' },
        { id: 'notif-2', type: 'PAYMENT_RECEIVED' },
      ];
      prisma.notification.findMany.mockResolvedValue(mockNotifs);

      const result = await notificationsModule.getRecent('user-1', 10);

      expect(result).toEqual(mockNotifs);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          take: 10,
          skip: 0,
        })
      );
    });

    test('forwards skip and where for pagination', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await notificationsModule.getRecent('user-1', 30, 30, { userId: 'user-1', isArchived: false });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isArchived: false },
          take: 30,
          skip: 30,
        })
      );
    });

    test('returns empty array on error', async () => {
      prisma.notification.findMany.mockRejectedValue(new Error('DB error'));

      const result = await notificationsModule.getRecent('user-1');

      expect(result).toEqual([]);
    });
  });
});
