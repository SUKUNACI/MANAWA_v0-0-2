/**
 * Tests for TwoFactorModule (enable, verify, disable with encrypted secrets)
 */

process.env.IDENTITY_AES_KEY = 'a'.repeat(64);

const bcrypt = require('bcryptjs');
const TwoFactorModule = require('../../modules/twoFactor');
const { decryptString } = require('../../utils/identityCrypto');

describe('TwoFactorModule with encrypted secrets', () => {
  let module;
  let prisma;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
    };

    module = new TwoFactorModule(prisma);
    module._twoFAUtils = {
      verify2FAToken: jest.fn(() => true),
      verifyBackupCode: jest.fn(),
      useBackupCode: jest.fn(),
      getRemainingBackupCodes: jest.fn(() => 10),
      setup2FA: jest.fn(),
      regenerateBackupCodes: jest.fn(),
    };
    module._twoFAConfig = { BACKUP_CODES_CONFIG: { count: 10 } };
  });

  test('enable() encrypts twoFASecret', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const setupToken = require('jsonwebtoken').sign(
      { userId: 'user-123', secret, hashedBackupCodes: ['hash1'], type: '2fa_setup' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    module._twoFAUtils.verify2FAToken.mockReturnValue(true);
    prisma.user.update.mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      twoFAEnabled: true,
      twoFAEnabledAt: new Date(),
    });

    await module.enable('user-123', setupToken, '123456');

    // Verify that update was called
    expect(prisma.user.update).toHaveBeenCalled();
    const updateCall = prisma.user.update.mock.calls[0][0];
    const encryptedSecret = updateCall.data.twoFASecret;

    // Verify secret is encrypted (starts with prefix)
    expect(encryptedSecret).toMatch(/^enc:v1:/);
    // Verify it decrypts back to the original
    expect(decryptString(encryptedSecret)).toBe(secret);
  });

  test('verify() decrypts twoFASecret before verification', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const { encryptString } = require('../../utils/identityCrypto');
    const encryptedSecret = encryptString(secret);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      role: 'CLIENT',
      adminLevel: null,
      adminPermissions: null,
      twoFAEnabled: true,
      twoFASecret: encryptedSecret,
      twoFABackupCodes: [],
    });
    prisma.refreshToken.create.mockResolvedValue({});

    await module.verify('user-123', { totpCode: '123456' });

    // Verify that verify2FAToken was called with the DECRYPTED secret
    expect(module._twoFAUtils.verify2FAToken).toHaveBeenCalledWith('123456', secret);
  });

  test('verify() accepts legacy plaintext (unencrypted) secrets', async () => {
    const secret = 'LEGACYSECRETPLAINTEXT';

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      role: 'CLIENT',
      adminLevel: null,
      adminPermissions: null,
      twoFAEnabled: true,
      twoFASecret: secret,
      twoFABackupCodes: [],
    });
    prisma.refreshToken.create.mockResolvedValue({});

    await module.verify('user-123', { totpCode: '123456' });

    // Verify that verify2FAToken was called with the plaintext secret (legacy compatibility)
    expect(module._twoFAUtils.verify2FAToken).toHaveBeenCalledWith('123456', secret);
  });

  test('disable() decrypts twoFASecret before verification', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const { encryptString } = require('../../utils/identityCrypto');
    const encryptedSecret = encryptString(secret);
    const passwordHash = await bcrypt.hash('password123', 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      passwordHash,
      twoFAEnabled: true,
      twoFASecret: encryptedSecret,
    });
    prisma.user.update.mockResolvedValue({});

    await module.disable('user-123', 'password123', '123456');

    // Verify that verify2FAToken was called with the DECRYPTED secret
    expect(module._twoFAUtils.verify2FAToken).toHaveBeenCalledWith('123456', secret);
    // Verify that update set twoFASecret to null
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { twoFAEnabled: false, twoFASecret: null, twoFABackupCodes: null, twoFAEnabledAt: null },
    });
  });
});
