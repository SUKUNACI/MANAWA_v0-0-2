/**
 * Q106: Tax calculation per country
 * MANAWA opère uniquement en Côte d'Ivoire
 * TVA Côte d'Ivoire : 18% (Code Général des Impôts ivoirien, Art. 339)
 */

const TAX_RATES = {
  CI: {
    country:     'Côte d\'Ivoire',
    currency:    'XOF',
    vat:         0.18,   // 18% TVA standard
    vatLabel:    'TVA',
    vatCode:     'CI-TVA-18',
    // Seuil d'assujettissement à la TVA : 50M XOF/an (DGI Côte d'Ivoire)
    vatThreshold: 50_000_000,
  },
};

// MANAWA est assujetti à la TVA (plateforme SaaS > seuil)
const DEFAULT_COUNTRY = 'CI';

/**
 * Calcule la TVA et le TTC pour un montant HT en XOF
 * Retourne { ht, tva, ttc, rate, vatCode }
 *
 * Ex: calculateTax(10000) →
 *   { ht: 10000, tva: 1800, ttc: 11800, rate: 0.18, vatCode: 'CI-TVA-18' }
 */
function calculateTax(amountHtXof, countryCode = DEFAULT_COUNTRY) {
  const config = TAX_RATES[countryCode] || TAX_RATES[DEFAULT_COUNTRY];
  const ht     = Math.round(amountHtXof);
  const tva    = Math.round(ht * config.vat);
  const ttc    = ht + tva;

  return {
    ht,
    tva,
    ttc,
    rate:    config.vat,
    vatCode: config.vatCode,
    country: config.country,
  };
}

/**
 * Extrait le HT depuis un montant TTC (calcul à rebours)
 * Ex: extractHtFromTtc(11800) → { ht: 10000, tva: 1800, ttc: 11800 }
 */
function extractHtFromTtc(amountTtcXof, countryCode = DEFAULT_COUNTRY) {
  const config = TAX_RATES[countryCode] || TAX_RATES[DEFAULT_COUNTRY];
  const ttc    = Math.round(amountTtcXof);
  const ht     = Math.round(ttc / (1 + config.vat));
  const tva    = ttc - ht;

  return {
    ht,
    tva,
    ttc,
    rate:    config.vat,
    vatCode: config.vatCode,
    country: config.country,
  };
}

/**
 * Commission MANAWA : 15% HT sur chaque transaction
 * Retourne { commissionHt, commissionTva, commissionTtc, professionalNet }
 */
function calculateCommission(transactionAmountXof, countryCode = DEFAULT_COUNTRY) {
  const COMMISSION_RATE = 0.15;
  const commissionHt   = Math.round(transactionAmountXof * COMMISSION_RATE);
  const { tva: commissionTva, ttc: commissionTtc } = calculateTax(commissionHt, countryCode);
  const professionalNet = transactionAmountXof - commissionTtc;

  return {
    transactionAmount: transactionAmountXof,
    commissionHt,
    commissionTva,
    commissionTtc,
    commissionRate:   COMMISSION_RATE,
    professionalNet,
  };
}

module.exports = {
  TAX_RATES,
  DEFAULT_COUNTRY,
  calculateTax,
  extractHtFromTtc,
  calculateCommission,
};
