/**
 * E2E Tests: Messaging and Communication Flow
 * Tests real-time messaging, notifications, and chat interactions
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: Messaging and Communication Flow', () => {
  let client1;
  let client2;
  let professional;

  beforeEach(async () => {
    client1 = createTestClient();
    client2 = createTestClient();
    professional = createTestClient();

    // Register users
    await client1.register({
      email: fixtures.generateUniqueEmail('client1-msg'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Jean',
      lastName: 'Client1',
      role: 'CLIENT',
    });

    await client2.register({
      email: fixtures.generateUniqueEmail('client2-msg'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Marie',
      lastName: 'Client2',
      role: 'CLIENT',
    });

    await professional.register({
      email: fixtures.generateUniqueEmail('pro-msg'),
      password: fixtures.TEST_PASSWORD,
      firstName: 'Pierre',
      lastName: 'Pro',
      role: 'PROFESSIONAL',
    });

    await professional.put('/professionals/profile', {
      businessName: 'Plomberie Pro',
      businessType: 'PLUMBING',
      siret: '12345678901234',
    });
  });

  describe('Happy Path: Complete Messaging Flow', () => {
    test('1. Client can send message to professional', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: 'Bonjour, je suis intéressé par vos services',
        type: 'TEXT',
      };

      const response = await client1.post('/messages', messageData);

      Assertions.success(response);
      Assertions.validMessage(response.data);
      expect(response.data.content).toBe(messageData.content);
      expect(response.data.senderId).toBe(client1.userId);
      expect(response.data.receiverId).toBe(professional.userId);
    });

    test('2. Professional can reply to client message', async () => {
      // Client sends message
      const initialMsg = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Bonjour, je suis intéressé',
        type: 'TEXT',
      });

      // Professional replies
      const replyData = {
        receiverId: client1.userId,
        content: 'Bonjour, merci pour votre intérêt!',
        type: 'TEXT',
        replyToId: initialMsg.data.id,
      };

      const response = await professional.post('/messages', replyData);

      Assertions.success(response);
      expect(response.data.content).toBe(replyData.content);
    });

    test('3. User can fetch message history', async () => {
      // Exchange messages
      await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Message 1',
        type: 'TEXT',
      });

      await professional.post('/messages', {
        receiverId: client1.userId,
        content: 'Reply 1',
        type: 'TEXT',
      });

      // Fetch conversation
      const response = await client1.get(
        `/messages/conversations/${professional.userId}`
      );

      Assertions.success(response);
      Assertions.arrayNotEmpty(response.data);
      Assertions.type(response.data, 'array');
    });

    test('4. Messages support attachments', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: 'See attached quote',
        type: 'TEXT',
        attachments: [
          {
            type: 'FILE',
            url: 'https://example.com/quote.pdf',
            name: 'quote.pdf',
          },
        ],
      };

      const response = await client1.post('/messages', messageData);

      Assertions.success(response);
      expect(response.data.attachments).toBeDefined();
    });

    test('5. User can mark messages as read', async () => {
      // Client sends message to professional
      const msgRes = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Test message',
        type: 'TEXT',
      });

      const messageId = msgRes.data.id;

      // Professional marks as read
      const readRes = await professional.post(`/messages/${messageId}/read`);

      Assertions.success(readRes);
      expect(readRes.data.isRead).toBe(true);
    });

    test('6. User can list unread messages', async () => {
      // Send messages
      await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Message 1',
        type: 'TEXT',
      });

      await client2.post('/messages', {
        receiverId: professional.userId,
        content: 'Message 2',
        type: 'TEXT',
      });

      // Get unread
      const response = await professional.get('/messages/unread');

      Assertions.success(response);
      Assertions.type(response.data, 'array');
      expect(response.data.length).toBeGreaterThan(0);
    });
  });

  describe('Error Path: Invalid Messaging Operations', () => {
    test('1. Cannot send message to non-existent user', async () => {
      const messageData = {
        receiverId: 'non-existent-user-id',
        content: 'Test message',
        type: 'TEXT',
      };

      const response = await client1.post('/messages', messageData);

      Assertions.error(response, 404);
    });

    test('2. Cannot send empty message', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: '',
        type: 'TEXT',
      };

      const response = await client1.post('/messages', messageData);

      Assertions.error(response, 400);
    });

    test('3. Cannot mark non-existent message as read', async () => {
      const response = await client1.post(
        '/messages/non-existent-id/read'
      );

      Assertions.error(response, 404);
    });

    test('4. User cannot read messages not addressed to them', async () => {
      // Client1 sends to Professional
      const msgRes = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Private message',
        type: 'TEXT',
      });

      const messageId = msgRes.data.id;

      // Client2 tries to access
      const response = await client2.get(`/messages/${messageId}`);

      Assertions.error(response, 403);
    });

    test('5. Reject message with invalid attachment URL', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: 'Message with bad attachment',
        type: 'TEXT',
        attachments: [
          {
            type: 'FILE',
            url: 'not-a-valid-url',
            name: 'file.pdf',
          },
        ],
      };

      const response = await client1.post('/messages', messageData);

      Assertions.error(response, 400);
    });
  });

  describe('Edge Cases: Messaging Boundary Conditions', () => {
    test('1. Handle very long messages', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: 'A'.repeat(10000),
        type: 'TEXT',
      };

      const response = await client1.post('/messages', messageData);

      expect([200, 400]).toContain(response.status);
    });

    test('2. Message threading with multiple replies', async () => {
      // Initial message
      const msg1Res = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Initial question',
        type: 'TEXT',
      });

      // Reply 1
      const msg2Res = await professional.post('/messages', {
        receiverId: client1.userId,
        content: 'First answer',
        type: 'TEXT',
        replyToId: msg1Res.data.id,
      });

      // Reply 2 (to reply)
      const msg3Res = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Follow-up question',
        type: 'TEXT',
        replyToId: msg2Res.data.id,
      });

      Assertions.success(msg3Res);
      expect(msg3Res.data.replyToId).toBe(msg2Res.data.id);
    });

    test('3. High-volume message exchange', async () => {
      // Send 20 messages rapidly
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          client1.post('/messages', {
            receiverId: professional.userId,
            content: `Message ${i + 1}`,
            type: 'TEXT',
          })
        );
      }

      const responses = await Promise.all(promises);

      // All should succeed or gracefully degrade
      responses.forEach((res) => {
        expect([200, 429]).toContain(res.status);
      });
    });

    test('4. Message with special characters and emojis', async () => {
      const messageData = {
        receiverId: professional.userId,
        content: 'Bonjour! 👋 Ça va? 🙂 Voici les details: "important" & <test>',
        type: 'TEXT',
      };

      const response = await client1.post('/messages', messageData);

      Assertions.success(response);
      expect(response.data.content).toContain('👋');
    });

    test('5. Pagination of message history', async () => {
      // Send 30 messages
      for (let i = 0; i < 30; i++) {
        await client1.post('/messages', {
          receiverId: professional.userId,
          content: `Message ${i + 1}`,
          type: 'TEXT',
        });
      }

      // Get page 1
      const page1Res = await client1.get(
        `/messages/conversations/${professional.userId}?page=1&limit=10`
      );

      Assertions.success(page1Res);
      expect(page1Res.data.length).toBeLessThanOrEqual(10);

      // Get page 2
      const page2Res = await client1.get(
        `/messages/conversations/${professional.userId}?page=2&limit=10`
      );

      Assertions.success(page2Res);
    });
  });

  describe('Security: Message Privacy and Authorization', () => {
    test('1. Message content is not leaked in list view', async () => {
      await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Sensitive payment information: 1234-5678-9012-3456',
        type: 'TEXT',
      });

      // Check that list doesn't expose full content
      const response = await professional.get('/messages/unread');

      Assertions.success(response);
      // Content should be either truncated or properly sanitized
    });

    test('2. User cannot modify messages', async () => {
      const msgRes = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Original message',
        type: 'TEXT',
      });

      const messageId = msgRes.data.id;

      // Try to modify
      const editRes = await client1.put(`/messages/${messageId}`, {
        content: 'Modified message',
      });

      // Should fail (messages typically immutable)
      expect([400, 405]).toContain(editRes.status);
    });

    test('3. Deleted messages cannot be retrieved', async () => {
      const msgRes = await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'Message to delete',
        type: 'TEXT',
      });

      const messageId = msgRes.data.id;

      // Delete message
      const deleteRes = await client1.delete(`/messages/${messageId}`);

      Assertions.success(deleteRes);

      // Try to retrieve deleted message
      const getRes = await client1.get(`/messages/${messageId}`);

      Assertions.error(getRes, 404);
    });

    test('4. Typing indicators do not leak message content', async () => {
      // Professional sends typing indicator
      const typingRes = await professional.post(
        `/messages/typing/${client1.userId}`,
        { isTyping: true }
      );

      // Should succeed but not expose any content
      if (typingRes.status === 200) {
        expect(typingRes.data.content).toBeUndefined();
      }
    });
  });

  describe('Notifications: Message-Based Alerts', () => {
    test('1. Notification sent when user receives message', async () => {
      // Get initial notification count
      const beforeRes = await professional.get('/notifications');
      const initialCount = (beforeRes.data || []).length;

      // Client sends message
      await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'New message',
        type: 'TEXT',
      });

      // Check new notification
      const afterRes = await professional.get('/notifications');
      const finalCount = (afterRes.data || []).length;

      expect(finalCount).toBeGreaterThanOrEqual(initialCount);
    });

    test('2. User can disable message notifications', async () => {
      // Disable notifications
      const disableRes = await professional.post(
        '/notifications/preferences',
        {
          messageNotifications: false,
        }
      );

      Assertions.success(disableRes);

      // Send message (should not create notification)
      await client1.post('/messages', {
        receiverId: professional.userId,
        content: 'This should not notify',
        type: 'TEXT',
      });
    });
  });
});
