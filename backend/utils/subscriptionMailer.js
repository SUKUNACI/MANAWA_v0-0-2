'use strict';

/**
 * Subscription email notifications — Phase 3
 *
 * Réutilise config/mailer.js (Mailjet) pour tous les événements d'abonnement.
 * Appelé par routes/webhooks-geniuspay.js (handleSubscriptionWebhook / notifySubscription)
 * et par jobs/cron-jobs.js (expireGracePeriods, sendGracePeriodReminders).
 *
 * Ne lève jamais d'exception — les erreurs sont loggées mais ne bloquent pas
 * le flux principal.
 */

const mailer = require('../config/mailer');
const logger = require('./logger');
const { generateSubscriptionReceiptBuffer } = require('./generateSubscriptionReceipt');
const { uploadBuffer } = require('../config/cloudinary');

// ── HTML helpers ──────────────────────────────────────────────────────────────

function wrapHtml(content) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#0A0D14;color:#fff;border-radius:12px;">
      <h2 style="color:#F97316;margin:0 0 4px 0;">MANAWA</h2>
      <p style="color:#6B7280;font-size:12px;margin:0 0 24px 0;">Gestion des abonnements</p>
      ${content}
      <p style="color:#6B7280;font-size:11px;margin-top:28px;border-top:1px solid #1A1F2E;padding-top:16px;">
        Cet email a été envoyé automatiquement. Ne pas répondre directement.
      </p>
    </div>`;
}

function infoBox(content) {
  return `<div style="background:#1A1F2E;border-radius:10px;padding:20px;margin-bottom:20px;">${content}</div>`;
}

function alertBox(content) {
  return `<div style="background:#1F1010;border:1px solid #EF4444;border-radius:10px;padding:20px;margin-bottom:20px;">${content}</div>`;
}

function row(label, value) {
  return `<p style="margin:6px 0;color:#9CA3AF;font-size:13px;"><strong style="color:#fff;">${label} :</strong> ${value}</p>`;
}

function tierLabel(tier) {
  const labels = { ESSENTIEL: 'Essentiel', PRO: 'Pro', ELITE: 'Elite', GRATUIT: 'Gratuit' };
  return labels[tier] || tier;
}

function cycleLabel(cycle) {
  return cycle === 'YEARLY' ? 'annuel' : 'mensuel';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatAmount(amount) {
  if (amount == null) return '—';
  return `${Number(amount).toLocaleString('fr-FR')} XOF`;
}

// ── Envoi sécurisé (jamais bloquant) ─────────────────────────────────────────

async function sendSafe(to, subject, html, text) {
  try {
    await mailer.send({ to, subject, html, text });
    logger.info('[SubMailer] Email envoyé', { to, subject });
  } catch (err) {
    logger.error('[SubMailer] Échec envoi email', { to, subject, error: err.message });
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * Paiement confirmé — abonnement activé.
 * Génère un reçu PDF et l'envoie en lien dans l'email de confirmation.
 * La génération du PDF n'est jamais bloquante : si elle échoue, l'email
 * est quand même envoyé sans lien de reçu.
 *
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.firstName
 * @param {string} opts.tier
 * @param {string} opts.billingCycle
 * @param {number} opts.amount
 * @param {Date}   opts.startedAt
 * @param {Date}   opts.expiresAt
 * @param {string} [opts.reference]       - geniuspayRef for the receipt
 * @param {string} [opts.professionalName]
 * @param {string} [opts.receiptNumber]
 */
async function sendSubscriptionActivated({
  email, firstName, tier, billingCycle, amount,
  startedAt, expiresAt, reference, professionalName, receiptNumber,
}) {
  const subject = `✅ Abonnement ${tierLabel(tier)} activé — MANAWA`;

  // Attempt to generate receipt PDF and upload to Cloudinary
  let receiptUrl = null;
  try {
    const buffer = await generateSubscriptionReceiptBuffer({
      professionalName: professionalName || firstName || email,
      professionalEmail: email,
      tier,
      billingCycle: billingCycle || 'MONTHLY',
      amount,
      reference,
      paymentDate: new Date(),
      startedAt,
      expiresAt,
      receiptNumber: receiptNumber || (reference ? `SUB-${reference.slice(-8).toUpperCase()}` : null),
    });

    const publicId = `sub-receipt-${(reference || Date.now()).toString().slice(-12)}`;
    receiptUrl = await uploadBuffer(buffer, 'manawa/receipts', {
      resource_type: 'raw',
      format: 'pdf',
      public_id: publicId,
      overwrite: true,
    });
  } catch (pdfErr) {
    logger.error('[SubMailer] Receipt PDF generation failed', { email, tier, error: pdfErr.message });
  }

  const receiptLink = receiptUrl
    ? `<p style="margin:16px 0 0 0;"><a href="${receiptUrl}" style="color:#F97316;font-size:13px;">📄 Télécharger votre reçu</a></p>`
    : '';

  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Votre paiement a bien été confirmé. Votre abonnement est maintenant actif.
    </p>
    ${infoBox(`
      <p style="color:#22C55E;font-weight:600;margin:0 0 12px 0;">✅ Paiement confirmé</p>
      ${row('Formule', `${tierLabel(tier)} (${cycleLabel(billingCycle || 'MONTHLY')})`)}
      ${row('Montant réglé', formatAmount(amount))}
      ${row('Début', formatDate(startedAt))}
      ${row('Renouvellement', formatDate(expiresAt))}
      ${receiptLink}
    `)}
    <p style="color:#9CA3AF;font-size:13px;">
      Pour renouveler votre abonnement avant l'échéance, rendez-vous dans votre espace professionnel.
    </p>
  `);
  const text = `Abonnement ${tierLabel(tier)} activé.\nMontant : ${formatAmount(amount)}\nExpiration : ${formatDate(expiresAt)}${receiptUrl ? `\n\nReçu : ${receiptUrl}` : ''}`;
  await sendSafe(email, subject, html, text);
}

/**
 * Paiement échoué — début de période de grâce
 */
async function sendPaymentFailed({ email, firstName, tier, gracePeriodEndsAt, reason }) {
  const subject = `⚠️ Paiement échoué — Abonnement ${tierLabel(tier)} — MANAWA`;
  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Votre paiement d'abonnement n'a pas pu être traité.
      Vous bénéficiez d'une <strong style="color:#F97316;">période de grâce de 3 jours</strong> pour régulariser votre situation.
    </p>
    ${alertBox(`
      <p style="color:#EF4444;font-weight:600;margin:0 0 12px 0;">⚠️ Action requise</p>
      ${row('Formule', tierLabel(tier))}
      ${row('Raison', reason || 'Paiement refusé')}
      ${row("Accès garanti jusqu'au", formatDate(gracePeriodEndsAt))}
    `)}
    <p style="color:#9CA3AF;font-size:13px;">
      Après cette date, votre compte reviendra en mode Gratuit.
      Relancez un paiement depuis votre espace professionnel pour maintenir votre abonnement.
    </p>
  `);
  const text = `Paiement échoué pour votre abonnement ${tierLabel(tier)}.\nPériode de grâce jusqu'au : ${formatDate(gracePeriodEndsAt)}`;
  await sendSafe(email, subject, html, text);
}

/**
 * Paiement annulé par l'utilisateur
 */
async function sendPaymentCancelled({ email, firstName, tier }) {
  const subject = `Paiement annulé — Abonnement ${tierLabel(tier)} — MANAWA`;
  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Vous avez annulé votre paiement d'abonnement ${tierLabel(tier)}.
      Votre compte reste inchangé.
    </p>
    ${infoBox(`
      <p style="color:#9CA3AF;font-size:13px;">
        Si vous souhaitez reprendre votre souscription, vous pouvez relancer un paiement depuis votre espace professionnel.
      </p>
    `)}
  `);
  const text = `Paiement annulé pour l'abonnement ${tierLabel(tier)}. Vous pouvez relancer la souscription depuis votre espace.`;
  await sendSafe(email, subject, html, text);
}

/**
 * Lien de paiement expiré (timeout 15 min GeniusPay)
 */
async function sendPaymentExpired({ email, firstName, tier }) {
  const subject = `Lien de paiement expiré — Abonnement ${tierLabel(tier)} — MANAWA`;
  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Le lien de paiement pour votre abonnement ${tierLabel(tier)} a expiré.
    </p>
    ${infoBox(`
      <p style="color:#9CA3AF;font-size:13px;">
        Les liens de paiement ont une durée de validité limitée. Lancez un nouveau paiement depuis votre espace professionnel.
      </p>
    `)}
  `);
  const text = `Le lien de paiement pour l'abonnement ${tierLabel(tier)} a expiré. Relancez un nouveau paiement.`;
  await sendSafe(email, subject, html, text);
}

/**
 * Rappel : fin de période de grâce dans moins de 24h
 */
async function sendGraceReminder({ email, firstName, tier, gracePeriodEndsAt }) {
  const subject = `⏰ Dernière chance — Abonnement ${tierLabel(tier)} expire demain — MANAWA`;
  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Votre période de grâce se termine <strong style="color:#F97316;">demain</strong>.
      Sans paiement, votre abonnement sera automatiquement résilié.
    </p>
    ${alertBox(`
      <p style="color:#F97316;font-weight:600;margin:0 0 12px 0;">⏰ Échéance imminente</p>
      ${row('Formule', tierLabel(tier))}
      ${row('Fin de grâce', formatDate(gracePeriodEndsAt))}
    `)}
    <p style="color:#9CA3AF;font-size:13px;">
      Régularisez votre paiement maintenant depuis votre espace professionnel pour conserver vos avantages.
    </p>
  `);
  const text = `Rappel : votre abonnement ${tierLabel(tier)} expire le ${formatDate(gracePeriodEndsAt)}. Régularisez votre paiement.`;
  await sendSafe(email, subject, html, text);
}

/**
 * Abonnement expiré — retour au mode Gratuit
 */
async function sendSubscriptionExpired({ email, firstName, tier }) {
  const subject = `Abonnement résilié — Retour au mode Gratuit — MANAWA`;
  const html = wrapHtml(`
    <p style="color:#9CA3AF;margin:0 0 16px 0;">Bonjour ${firstName || 'Professionnel'},</p>
    <p style="color:#9CA3AF;margin:0 0 20px 0;">
      Votre abonnement ${tierLabel(tier)} a été résilié. Votre compte est maintenant en mode <strong style="color:#fff;">Gratuit</strong>.
    </p>
    ${infoBox(`
      <p style="color:#9CA3AF;font-size:13px;">
        Vous pouvez reprendre un abonnement payant à tout moment depuis votre espace professionnel.
      </p>
    `)}
  `);
  const text = `Votre abonnement ${tierLabel(tier)} a été résilié. Votre compte est en mode Gratuit.`;
  await sendSafe(email, subject, html, text);
}

module.exports = {
  sendSubscriptionActivated,
  sendPaymentFailed,
  sendPaymentCancelled,
  sendPaymentExpired,
  sendGraceReminder,
  sendSubscriptionExpired,
};
