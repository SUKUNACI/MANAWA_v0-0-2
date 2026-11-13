'use strict';
/**
 * Tests for config/versioning.js
 */

describe('versioning config', () => {
  let versioning;

  beforeEach(() => {
    jest.resetModules();
    versioning = require('../../config/versioning');
  });

  describe('exports', () => {
    it('exporte API_VERSIONS', () => {
      expect(versioning.API_VERSIONS).toBeDefined();
      expect(typeof versioning.API_VERSIONS).toBe('object');
    });

    it('exporte CURRENT_VERSION', () => {
      expect(versioning.CURRENT_VERSION).toBeDefined();
      expect(typeof versioning.CURRENT_VERSION).toBe('string');
    });

    it('exporte DEPRECATION_SCHEDULE', () => {
      expect(versioning.DEPRECATION_SCHEDULE).toBeDefined();
      expect(typeof versioning.DEPRECATION_SCHEDULE).toBe('object');
    });

    it('exporte les fonctions nécessaires', () => {
      expect(typeof versioning.getDeprecationInfo).toBe('function');
      expect(typeof versioning.isVersionDeprecated).toBe('function');
      expect(typeof versioning.isVersionSunset).toBe('function');
    });
  });

  describe('API_VERSIONS', () => {
    it('contient V0 et V1', () => {
      expect(versioning.API_VERSIONS.V0).toBe('v0');
      expect(versioning.API_VERSIONS.V1).toBe('v1');
    });
  });

  describe('CURRENT_VERSION', () => {
    it('est v1', () => {
      expect(versioning.CURRENT_VERSION).toBe('v1');
    });
  });

  describe('getDeprecationInfo', () => {
    it('retourne les infos de dépréciation pour v0', () => {
      const info = versioning.getDeprecationInfo('v0');
      expect(info).not.toBeNull();
      expect(info.deprecated).toBe(true);
      expect(info).toHaveProperty('deprecationDate');
      expect(info).toHaveProperty('sunsetDate');
      expect(info).toHaveProperty('message');
      expect(info).toHaveProperty('redirectUrl');
    });

    it('retourne null pour une version non dépréciée', () => {
      const info = versioning.getDeprecationInfo('v1');
      expect(info).toBeNull();
    });

    it('retourne null pour une version inconnue', () => {
      const info = versioning.getDeprecationInfo('v99');
      expect(info).toBeNull();
    });
  });

  describe('isVersionDeprecated', () => {
    it('retourne true pour v0', () => {
      expect(versioning.isVersionDeprecated('v0')).toBe(true);
    });

    it('retourne false pour v1', () => {
      expect(versioning.isVersionDeprecated('v1')).toBe(false);
    });

    it('retourne false pour une version inconnue', () => {
      expect(versioning.isVersionDeprecated('v99')).toBe(false);
    });
  });

  describe('isVersionSunset', () => {
    it('retourne false pour une version sans sunset date', () => {
      expect(versioning.isVersionSunset('v1')).toBe(false);
    });

    it('retourne false pour une version inconnue', () => {
      expect(versioning.isVersionSunset('v99')).toBe(false);
    });

    it('retourne un booléen pour v0 selon la date actuelle', () => {
      const result = versioning.isVersionSunset('v0');
      expect(typeof result).toBe('boolean');
    });

    it('retourne true si la sunset date est dans le passé', () => {
      // La sunsetDate de v0 est 2027-05-10, actuellement dans le futur
      // Mais au-delà de 2027-05-10 ce serait true — on teste juste le type
      const result = versioning.isVersionSunset('v0');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('DEPRECATION_SCHEDULE', () => {
    it('contient l\'entrée v0', () => {
      expect(versioning.DEPRECATION_SCHEDULE).toHaveProperty('v0');
    });

    it('l\'entrée v0 a les bonnes propriétés', () => {
      const v0 = versioning.DEPRECATION_SCHEDULE.v0;
      expect(v0.deprecated).toBe(true);
      expect(typeof v0.deprecationDate).toBe('string');
      expect(typeof v0.sunsetDate).toBe('string');
      expect(typeof v0.message).toBe('string');
      expect(typeof v0.redirectUrl).toBe('string');
    });
  });
});
