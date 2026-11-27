/**
 * AuthModule Tests — changePassword implementation
 */

const bcrypt = require('bcryptjs');
const AuthModule = require('../../modules/auth');

describe('AuthModule.changePassword', () => {
  let authModule;
  let prisma;
  let mockUser;

  beforeEach(async () => {
    mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      passwordHash: await bcrypt.hash('OldPassword123', 10),
    };

    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        deleteMany: jest.fn(),
      },
    };

    authModule = new AuthModule(prisma);
  });

  test('should throw 404 when user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authModule.changePassword('nonexistent-id', 'OldPassword123', 'NewPassword123')
    ).rejects.toMatchObject({
      message: 'Utilisateur non trouvé',
      status: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  test('should throw 401 when current password is invalid', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      authModule.changePassword('user-123', 'WrongPassword', 'NewPassword123')
    ).rejects.toMatchObject({
      message: 'Mot de passe actuel incorrect',
      status: 401,
      code: 'INVALID_CURRENT_PASSWORD',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  test('should throw 409 when new password is same as current', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      authModule.changePassword('user-123', 'OldPassword123', 'OldPassword123')
    ).rejects.toMatchObject({
      message: "Le nouveau mot de passe doit être différent de l'ancien",
      status: 409,
      code: 'PASSWORD_UNCHANGED',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  test('should successfully change password', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({ id: 'user-123' });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const result = await authModule.changePassword('user-123', 'OldPassword123', 'NewPassword123');

    expect(result).toEqual({ changed: true });

    // Verify user.update was called with correct data
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: {
        passwordHash: expect.any(String),
        mustChangePassword: false,
      },
    });

    // Verify new password hash is different from old
    const updateCall = prisma.user.update.mock.calls[0][0];
    const newHash = updateCall.data.passwordHash;
    const isValidNewPassword = await bcrypt.compare('NewPassword123', newHash);
    expect(isValidNewPassword).toBe(true);

    // Verify refresh tokens were revoked
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
    });
  });

  test('should set mustChangePassword to false on successful change', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({ id: 'user-123' });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

    await authModule.changePassword('user-123', 'OldPassword123', 'NewPassword123');

    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.data.mustChangePassword).toBe(false);
  });
});
