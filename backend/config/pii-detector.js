/**
 * Q99: PII Detection
 * Q100: Sensitive Data Masking in Logs
 * Detect and mask PII before it reaches log files
 */

// Patterns that identify PII in log data
// Order matters: longer/more specific patterns must come before shorter ones that could match substrings
const PII_PATTERNS = [
  { name: 'jwt',         regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,   mask: () => '[JWT]'     },
  { name: 'iban',        regex: /[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}/g,             mask: () => '[IBAN]'    },
  { name: 'email',       regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,          mask: (m) => maskEmail(m) },
  { name: 'phone_fr',    regex: /(?:\+33|0033|0)[1-9](?:[\s.\-]?\d{2}){4}/g,                    mask: () => '[PHONE]'   },
  { name: 'phone_intl',  regex: /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{1,9}/g, mask: () => '[PHONE]' },
  { name: 'card_number', regex: /\b(?:\d[ \-]?){13,19}\b/g,                                      mask: (m) => maskCard(m) },
  { name: 'siret',       regex: /\b\d{3}[ \-]?\d{3}[ \-]?\d{3}[ \-]?\d{5}\b/g,                 mask: () => '[SIRET]'   },
  { name: 'siren',       regex: /\b\d{3}[ \-]?\d{3}[ \-]?\d{3}\b/g,                             mask: () => '[SIREN]'   },
  { name: 'ip_v4',       regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                                 mask: (m) => maskIp(m)  },
  { name: 'ip_v6',       regex: /([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,                     mask: () => '[IPv6]'    },
  { name: 'password',    regex: /"password"\s*:\s*"[^"]+"/gi,                                    mask: () => '"password":"[REDACTED]"' },
  { name: 'secret',      regex: /"(?:secret|token|apiKey|api_key|privateKey|private_key)"\s*:\s*"[^"]+"/gi, mask: () => '"[REDACTED_KEY]":"[REDACTED]"' },
];

// Fields that should always be masked when they appear as object keys
const SENSITIVE_FIELD_NAMES = new Set([
  'password', 'passwordHash', 'twoFASecret', 'twoFABackupCodes',
  'securityAnswerHash', 'token', 'refreshToken', 'apiKey', 'secret',
  'privateKey', 'bankIban', 'cardNumber', 'cvv', 'pin',
]);

/**
 * Detect PII types present in a string
 * Returns array of detected PII type names (no values)
 */
function detectPii(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  for (const pattern of PII_PATTERNS) {
    if (pattern.regex.test(text)) {
      found.push(pattern.name);
    }
    pattern.regex.lastIndex = 0; // reset stateful regex
  }
  return found;
}

/**
 * Mask PII in a string using pattern replacements
 */
function maskString(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern.regex, pattern.mask);
    pattern.regex.lastIndex = 0;
  }
  return result;
}

/**
 * Recursively mask PII in a plain object (for log data payloads)
 * Sensitive field names are replaced with '[REDACTED]'
 * String values are run through maskString
 */
function maskObject(obj, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return maskString(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => maskObject(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELD_NAMES.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = maskObject(value, depth + 1);
    }
  }
  return result;
}

// ─── Mask helpers ─────────────────────────────────────────────────────────────

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return '[EMAIL]';
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***@${domain}`;
}

function maskCard(number) {
  const digits = number.replace(/\D/g, '');
  return `****-****-****-${digits.slice(-4)}`;
}

function maskIp(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return '[IP]';
  return `${parts[0]}.${parts[1]}.*.*`;
}

module.exports = {
  detectPii,
  maskString,
  maskObject,
  PII_PATTERNS,
  SENSITIVE_FIELD_NAMES,
};
