/**
 * API Versioning Configuration
 *
 * Manages API versioning across MANAWA backend.
 * Supports multiple API versions with deprecation schedule.
 */

/**
 * API Versions
 */
const API_VERSIONS = {
  V0: 'v0',
  V1: 'v1',
};

/**
 * Current active API version
 */
const CURRENT_VERSION = API_VERSIONS.V1;

/**
 * Deprecation schedule
 * Maps old versions to their deprecation info
 */
const DEPRECATION_SCHEDULE = {
  v0: {
    deprecated: true,
    deprecationDate: '2026-11-10',
    sunsetDate: '2027-05-10', // 6 months after deprecation
    message: 'API v0 is deprecated. Please migrate to v1.',
    redirectUrl: '/api/v1',
  },
};

/**
 * Get deprecation info for a version
 * @param {string} version - API version
 * @returns {object|null} Deprecation info or null if not deprecated
 */
function getDeprecationInfo(version) {
  return DEPRECATION_SCHEDULE[version] || null;
}

/**
 * Check if version is deprecated
 * @param {string} version - API version
 * @returns {boolean}
 */
function isVersionDeprecated(version) {
  const info = getDeprecationInfo(version);
  return info ? info.deprecated : false;
}

/**
 * Check if version is sunset (no longer supported)
 * @param {string} version - API version
 * @returns {boolean}
 */
function isVersionSunset(version) {
  const info = getDeprecationInfo(version);
  if (!info || !info.sunsetDate) return false;
  return new Date() > new Date(info.sunsetDate);
}

module.exports = {
  API_VERSIONS,
  CURRENT_VERSION,
  DEPRECATION_SCHEDULE,
  getDeprecationInfo,
  isVersionDeprecated,
  isVersionSunset,
};
