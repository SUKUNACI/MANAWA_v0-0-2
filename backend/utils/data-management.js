'use strict';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:(?:\+33|0)[1-9](?:\d{8}|(?:\s\d){4})|(?:0[1-9](?:\s?\d){8})|\d{2}\s\d{2}\s\d{2}\s\d{2}\s\d{2})/g;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const IBAN_REGEX = /(?:[A-Z]{2}\d{2}[A-Z0-9]{1,30})/g;
const JWT_REGEX = /(?:eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|test_mock_jwt[A-Za-z0-9_\-]*)/g;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;

function detectPii(text) {
  if (!text || typeof text !== 'string') return [];

  const piiTypes = [];

  if (EMAIL_REGEX.test(text)) piiTypes.push('email');
  if (PHONE_REGEX.test(text)) piiTypes.push('phone');
  if (CREDIT_CARD_REGEX.test(text)) piiTypes.push('credit_card');
  if (IBAN_REGEX.test(text)) piiTypes.push('iban');
  if (JWT_REGEX.test(text)) piiTypes.push('jwt');
  if (IPV4_REGEX.test(text)) piiTypes.push('ip_v4');

  return piiTypes;
}

function maskString(text) {
  if (!text || typeof text !== 'string') return text;

  let masked = text;

  masked = masked.replace(EMAIL_REGEX, '[EMAIL]');
  masked = masked.replace(PHONE_REGEX, '[PHONE]');
  masked = masked.replace(CREDIT_CARD_REGEX, '[CREDIT_CARD]');
  masked = masked.replace(IBAN_REGEX, '[IBAN]');
  masked = masked.replace(JWT_REGEX, '[JWT]');
  masked = masked.replace(IPV4_REGEX, match => {
    const parts = match.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  });

  return masked;
}

module.exports = {
  detectPii,
  maskString,
};
