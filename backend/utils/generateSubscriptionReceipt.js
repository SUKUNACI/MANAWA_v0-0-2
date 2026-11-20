'use strict';

/**
 * Génération de reçus de paiement d'abonnement — Phase 3
 *
 * Produit un PDF minimaliste (PDFKit, en mémoire) pour chaque paiement
 * d'abonnement confirmé. Le buffer est renvoyé à l'appelant ; c'est lui
 * qui décide de l'envoyer par email, de l'uploader, etc.
 *
 * Ne lève jamais d'exception — les erreurs sont propagées normalement
 * (l'appelant doit les attraper et les logger).
 *
 * Données d'entrée attendues (receiptData) :
 *   professionalName : string
 *   professionalEmail: string
 *   tier             : 'ESSENTIEL' | 'PRO' | 'ELITE'
 *   billingCycle     : 'MONTHLY' | 'YEARLY'
 *   amount           : number  (XOF)
 *   reference        : string  (geniuspayRef)
 *   paymentDate      : Date
 *   startedAt        : Date
 *   expiresAt        : Date
 *   receiptNumber    : string  (ex: 'SUB-20261120-abc12')
 */

const PDFDocument = require('pdfkit');

const ORANGE = '#F4720B';
const DARK   = '#1A1A2E';
const MUTED  = '#6B7280';
const BORDER = '#E5E7EB';

function fmt(n) {
  return Number(n).toLocaleString('fr-FR');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function tierLabel(tier) {
  const labels = { ESSENTIEL: 'Essentiel', PRO: 'Pro', ELITE: 'Elite' };
  return labels[tier] || tier;
}

function cycleLabel(cycle) {
  return cycle === 'YEARLY' ? 'Annuel' : 'Mensuel';
}

/**
 * Génère un buffer PDF de reçu d'abonnement.
 * @param {object} receiptData
 * @returns {Promise<Buffer>}
 */
function generateSubscriptionReceiptBuffer(receiptData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    buildReceiptContent(doc, receiptData);
    doc.end();
  });
}

function buildReceiptContent(doc, data) {
  const {
    professionalName,
    professionalEmail,
    tier,
    billingCycle,
    amount,
    reference,
    paymentDate,
    startedAt,
    expiresAt,
    receiptNumber,
  } = data;

  const pageW = doc.page.width - 100; // margins 50 each side

  // ── En-tête ──────────────────────────────────────────────────────────────────
  doc.rect(50, 50, pageW, 60).fill(DARK);
  doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
    .text('MANAWA', 60, 65);
  doc.fillColor(ORANGE).fontSize(10).font('Helvetica')
    .text('Reçu de paiement', 60, 90);

  doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica')
    .text(`Réf. ${receiptNumber || reference}`, 300, 65, { align: 'right', width: pageW - 250 })
    .text(`Date : ${fmtDate(paymentDate)}`, 300, 80, { align: 'right', width: pageW - 250 });

  doc.moveDown(3);

  // ── Bloc client ───────────────────────────────────────────────────────────────
  const y = doc.y;
  doc.rect(50, y, pageW / 2 - 10, 70).fill('#F9FAFB');
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold')
    .text('FACTURÉ À', 60, y + 10);
  doc.font('Helvetica').fillColor(MUTED)
    .text(professionalName || '—', 60, y + 24)
    .text(professionalEmail || '—', 60, y + 38);

  // ── Détail abonnement ─────────────────────────────────────────────────────────
  doc.moveDown(5);
  const tableY = doc.y;

  // En-tête tableau
  doc.rect(50, tableY, pageW, 20).fill(DARK);
  doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
    .text('Description',  60, tableY + 6)
    .text('Cycle',        250, tableY + 6)
    .text('Période',      350, tableY + 6)
    .text('Montant',      500, tableY + 6, { align: 'right' });

  // Ligne article
  const rowY = tableY + 20;
  doc.rect(50, rowY, pageW, 24).fill('#F9FAFB');
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
    .text(`Abonnement ${tierLabel(tier)}`, 60, rowY + 8)
    .text(cycleLabel(billingCycle),        250, rowY + 8)
    .text(`${fmtDate(startedAt)} → ${fmtDate(expiresAt)}`, 350, rowY + 8)
    .text(`${fmt(amount)} XOF`,            500, rowY + 8, { align: 'right' });

  // Total
  const totalY = rowY + 24;
  doc.rect(50, totalY, pageW, 24).fill(ORANGE);
  doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
    .text('TOTAL PAYÉ', 60, totalY + 7)
    .text(`${fmt(amount)} XOF`, 500, totalY + 7, { align: 'right' });

  doc.moveDown(5);

  // ── Référence de transaction ──────────────────────────────────────────────────
  doc.fillColor(MUTED).fontSize(8).font('Helvetica')
    .text(`Référence de transaction : ${reference || '—'}`, 50, doc.y)
    .text(`Méthode de paiement : GeniusPay (Mobile Money — XOF)`, 50, doc.y + 12);

  doc.moveDown(3);

  // ── Pied de page légal ────────────────────────────────────────────────────────
  doc.moveTo(50, doc.y).lineTo(50 + pageW, doc.y).stroke(BORDER);
  doc.moveDown(0.5);
  doc.fillColor(MUTED).fontSize(7).font('Helvetica')
    .text(
      "Ce document constitue un reçu de paiement valide. Il ne s'agit pas d'une facture au sens fiscal. " +
      'MANAWA — Côte d\'Ivoire. Pour toute question : support@manawa.app',
      50, doc.y, { width: pageW, align: 'center' }
    );
}

module.exports = { generateSubscriptionReceiptBuffer };
