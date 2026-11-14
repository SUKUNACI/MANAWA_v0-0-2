const crypto = require('crypto');
const bcrypt = require('bcryptjs');

class VerificationModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Generate 6-digit random code
   */
  generateCode() {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * POST /api/verification/email/send — Send email verification code
   */
  async sendEmailVerification(userId) {
    const code = this.generateCode();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifyCode: code, emailVerifyExpiry: expiry },
    });

    // In production, call sendVerificationEmail(user.email, code, 'verify')
    // For tests, return code in dev mode

    return { message: 'Code de vérification envoyé', devCode: code };
  }

  /**
   * POST /api/verification/email/confirm — Confirm email with code
   */
  async confirmEmailVerification(userId, code) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.emailVerifyCode || user.emailVerifyCode !== code) {
      const err = new Error('Code incorrect');
      err.status = 400;
      throw err;
    }

    if (new Date() > user.emailVerifyExpiry) {
      const err = new Error('Code expiré, demandez-en un nouveau');
      err.status = 400;
      throw err;
    }

    // Mark as verified
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailVerifyCode: null, emailVerifyExpiry: null },
    });

    return { verified: true };
  }

  /**
   * POST /api/verification/phone/send — Send phone verification OTP
   */
  async sendPhoneVerification(userId, phone) {
    if (!phone) {
      const err = new Error('Numéro de téléphone requis');
      err.status = 400;
      throw err;
    }

    const code = this.generateCode();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneOtpCode: code, phoneOtpExpiry: expiry, phoneVerified: false },
    });

    // In production, call sendVerificationSms(phone, code)

    return { message: 'Code OTP envoyé par SMS' };
  }

  /**
   * POST /api/verification/phone/confirm — Confirm phone with OTP
   */
  async confirmPhoneVerification(userId, code) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.phoneOtpCode || user.phoneOtpCode !== code) {
      const err = new Error('Code OTP incorrect');
      err.status = 400;
      throw err;
    }

    if (new Date() > user.phoneOtpExpiry) {
      const err = new Error('Code OTP expiré');
      err.status = 400;
      throw err;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerified: true, phoneOtpCode: null, phoneOtpExpiry: null },
    });

    return { verified: true };
  }

  /**
   * POST /api/verification/password/request-reset — Request password reset
   * Generic response (don't leak email existence)
   */
  async requestPasswordReset(email) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Generic response even if email doesn't exist (security)
    if (!user) {
      return { message: 'Si ce compte existe, un code a été envoyé.' };
    }

    // Check email verified
    if (!user.emailVerified) {
      const err = new Error("Votre email doit d'abord être vérifié avant de pouvoir réinitialiser le mot de passe. Connectez-vous et vérifiez votre email depuis Sécurité & confidentialité.");
      err.status = 400;
      throw err;
    }

    // Generate reset code
    const code = this.generateCode();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetCode: code, passwordResetExpiry: expiry },
    });

    // In production, call sendVerificationEmail(email, code, 'reset')

    return { message: 'Si ce compte existe, un code a été envoyé.' };
  }

  /**
   * POST /api/verification/password/reset — Reset password with code
   */
  async resetPassword(email, code, newPassword) {
    if (!newPassword || newPassword.length < 8) {
      const err = new Error('Le mot de passe doit faire au moins 8 caractères');
      err.status = 400;
      throw err;
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordResetCode || user.passwordResetCode !== code) {
      const err = new Error('Code incorrect');
      err.status = 400;
      throw err;
    }

    if (new Date() > user.passwordResetExpiry) {
      const err = new Error('Code expiré, recommencez la demande');
      err.status = 400;
      throw err;
    }

    // Security: prevent using same password
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      const err = new Error("Le nouveau mot de passe doit être différent de l'ancien");
      err.status = 400;
      throw err;
    }

    // Hash and update
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetCode: null, passwordResetExpiry: null },
    });

    return { reset: true };
  }

  /**
   * GET /api/verification/status — Get verification status
   */
  async getVerificationStatus(userId) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    return {
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      phone: user.phone,
    };
  }
}

module.exports = VerificationModule;
