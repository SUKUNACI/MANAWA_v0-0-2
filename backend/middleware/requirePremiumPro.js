'use strict';

const prisma = require('../config/db');
const { isPremiumActive } = require('../utils/subscription-helpers');

/**
 * Verifies the authenticated professional has an active premium subscription.
 * On success attaches `req.pro` (professional record with subscription included)
 * and calls next(). Returns 404 when the profile does not exist, 403 when the
 * tier is GRATUIT or the subscription has expired.
 */
async function requirePremiumPro(req, res, next) {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      include: { subscription: true },
    });

    if (!pro) return res.status(404).json({ error: 'Profil pro introuvable' });
    if (!isPremiumActive(pro.subscription, pro)) {
      return res.status(403).json({
        error: 'Fonctionnalité réservée aux abonnements premium',
        upgrade: true,
      });
    }

    req.pro = pro;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requirePremiumPro;
