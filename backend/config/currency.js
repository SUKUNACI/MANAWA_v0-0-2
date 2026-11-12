/**
 * Q104: Multi-currency support
 * MANAWA opère uniquement en Côte d'Ivoire — devise unique : XOF (Franc CFA)
 * Le taux EUR/XOF est fixe dans la zone UEMOA (arrimage au franc français historique)
 */

const CURRENCY = {
  code:     'XOF',
  name:     'Franc CFA (UEMOA)',
  symbol:   'F CFA',
  decimals: 0,       // Le XOF ne s'exprime pas en centimes
  locale:   'fr-CI', // Locale de formatage Côte d'Ivoire
};

// Taux de change de référence (fixe UEMOA, révisé périodiquement)
const EXCHANGE_RATES = {
  EUR_TO_XOF: 655.957, // Taux fixe officiel UEMOA
  XOF_TO_EUR: 1 / 655.957,
  USD_TO_XOF: 600,     // Approximatif, à mettre à jour via cron si besoin
  XOF_TO_USD: 1 / 600,
};

/**
 * Formate un montant en XOF pour l'affichage
 * Ex: formatXOF(15000) → "15 000 F CFA"
 */
function formatXOF(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '0 F CFA';
  return `${Math.round(amount).toLocaleString('fr-CI')} F CFA`;
}

/**
 * Convertit EUR → XOF
 */
function eurToXof(amountEur) {
  return Math.round(amountEur * EXCHANGE_RATES.EUR_TO_XOF);
}

/**
 * Convertit XOF → EUR
 */
function xofToEur(amountXof) {
  return parseFloat((amountXof * EXCHANGE_RATES.XOF_TO_EUR).toFixed(2));
}

/**
 * Valide qu'un montant XOF est dans les limites acceptables
 * Min: 100 XOF, Max: 10 000 000 XOF (10M)
 */
function validateXofAmount(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return { valid: false, error: 'Montant invalide' };
  if (amount < 100)         return { valid: false, error: 'Montant minimum : 100 XOF' };
  if (amount > 10_000_000)  return { valid: false, error: 'Montant maximum : 10 000 000 XOF' };
  if (amount !== Math.round(amount)) return { valid: false, error: 'Le XOF ne supporte pas les décimales' };
  return { valid: true };
}

module.exports = {
  CURRENCY,
  EXCHANGE_RATES,
  formatXOF,
  eurToXof,
  xofToEur,
  validateXofAmount,
};
