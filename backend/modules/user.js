const bcrypt = require('bcryptjs');

class UserModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * PATCH /api/users/me — Update user profile
   * CLIENT can update: firstName, lastName, phone, city
   * PROFESSIONAL can only update: phone, city
   */
  async updateProfile(userId, updateData, userRole) {
    const { firstName, lastName, phone, city } = updateData;

    // Check user not deleted
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt !== null) {
      const err = new Error('User not found or deleted');
      err.status = 401;
      throw err;
    }

    // Check user not suspended
    if (user.suspended) {
      const err = new Error('Accès refusé');
      err.status = 403;
      throw err;
    }

    // Build update data based on role
    const data = {};

    // For CLIENT: allow firstName/lastName
    // For PROFESSIONAL: ignore firstName/lastName
    if (userRole === 'CLIENT') {
      if (firstName !== undefined) data.firstName = firstName;
      if (lastName !== undefined) data.lastName = lastName;
    }

    // Both roles can update phone, city
    if (phone !== undefined) data.phone = phone;
    if (city !== undefined) data.city = city;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { professional: true },
    });

    // Return without passwordHash
    const { passwordHash: _, ...userSafe } = updatedUser;
    return userSafe;
  }

  /**
   * GET /api/users/me/recently-viewed — Get recently viewed professionals
   * Deduplicated by professionalId, max 10
   */
  async getRecentlyViewed(userId, limit = 10) {
    const views = await this.prisma.profileView.findMany({
      where: { viewerId: userId },
      include: {
        professional: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Deduplicate by professionalId (keep only most recent)
    const seen = new Set();
    const unique = views.filter((v) => {
      if (seen.has(v.professionalId)) return false;
      seen.add(v.professionalId);
      return true;
    });

    return unique.slice(0, limit).map((v) => v.professional);
  }

  /**
   * GET /api/users/me/following — Get followed professionals
   */
  async getFollowing(userId) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        professional: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return follows.map((f) => f.professional);
  }

  /**
   * POST /api/users/me/avatar — Upload avatar (handled by route)
   */
  async uploadAvatar(userId, fileBuffer) {
    // File upload handled by route middleware (multer + uploadBuffer)
    return { success: true };
  }

  /**
   * DELETE /api/users/me — Soft-delete account
   * Requires password confirmation
   * Cleans up push tokens and refresh tokens
   */
  async deleteAccount(userId, password) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      const err = new Error('User not found');
      err.status = 401;
      throw err;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      const err = new Error('Mot de passe incorrect');
      err.status = 401;
      throw err;
    }

    // Soft-delete
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    // Clean up tokens
    await this.prisma.pushToken.deleteMany({ where: { userId } });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    return { deleted: true };
  }

  /**
   * PATCH /api/users/me/password — Change password
   * Requires current password verification
   * Invalidates all refresh tokens
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      const err = new Error('User not found');
      err.status = 401;
      throw err;
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      const err = new Error('Mot de passe actuel incorrect');
      err.status = 401;
      throw err;
    }

    // Hash and update
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Invalidate all sessions
    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    return { changed: true };
  }
}

module.exports = UserModule;
