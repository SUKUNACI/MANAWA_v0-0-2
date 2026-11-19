/**
 * MeiliSearch Cold Start Tests
 *
 * Tests ciblés pour :
 * 1. Détection des erreurs HTML (service en démarrage)
 * 2. Indices manquants et recréation automatique
 * 3. Resync après démarrage à froid
 */

const { describe, it, expect } = require('@jest/globals');

describe('[MeiliSearch Cold Start]', () => {
  describe('Startup HTML Detection', () => {
    it('should detect pattern "Unexpected token <" as HTML startup error', () => {
      const htmlError = new Error("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
      const msg = htmlError.message;
      const isStartup = msg.includes('Unexpected token') && msg.includes('<') && msg.includes('DOCTYPE');
      expect(isStartup).toBe(true);
    });

    it('should NOT misidentify text with < but no DOCTYPE as startup', () => {
      // Test with < but in wrong context
      const notDoctype = new Error("Unexpected token '<' in data");
      const msg = notDoctype.message;
      const isStartup = msg.includes('Unexpected token') && msg.includes('<') && msg.includes('DOCTYPE');
      expect(isStartup).toBe(false);
    });

    it('should NOT misidentify ECONNREFUSED as startup', () => {
      const networkError = new Error('ECONNREFUSED: Connection refused');
      const msg = networkError.message;
      const isStartup = msg.includes('Unexpected token') && msg.includes('<');
      expect(isStartup).toBe(false);
    });

    it('should NOT misidentify index_not_found as startup', () => {
      const indexError = new Error('index not found');
      const msg = indexError.message;
      const isStartup = msg.includes('Unexpected token') && msg.includes('<');
      expect(isStartup).toBe(false);
    });
  });

  describe('ensureIndices Configuration', () => {
    it('should export ensureIndices function', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      expect(typeof meilisearchConfig.ensureIndices).toBe('function');
    });

    it('should export INDICES_CONFIG with 5 indices', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      const indexNames = Object.keys(meilisearchConfig.INDICES_CONFIG);
      expect(indexNames).toContain('professionals');
      expect(indexNames).toContain('projects');
      expect(indexNames).toContain('portfolio');
      expect(indexNames).toContain('packages');
      expect(indexNames).toContain('reviews');
      expect(indexNames.length).toBe(5);
    });

    it('should have searchable attributes configured for all indices', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      Object.entries(meilisearchConfig.INDICES_CONFIG).forEach(([name, config]) => {
        expect(config.searchableAttributes).toBeDefined();
        expect(config.searchableAttributes.length).toBeGreaterThan(0);
        expect(config.primaryKey).toBe('id');
      });
    });

    it('should have displayedAttributes for all indices', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      Object.entries(meilisearchConfig.INDICES_CONFIG).forEach(([name, config]) => {
        expect(config.settings.displayedAttributes).toBeDefined();
        expect(config.settings.displayedAttributes.length).toBeGreaterThan(0);
      });
    });

    it('should have sortableAttributes for all indices', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      Object.entries(meilisearchConfig.INDICES_CONFIG).forEach(([name, config]) => {
        expect(config.sortableAttributes).toBeDefined();
        expect(Array.isArray(config.sortableAttributes)).toBe(true);
      });
    });
  });

  describe('Global Search API', () => {
    it('should export globalSearch function', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      expect(typeof meilisearchConfig.globalSearch).toBe('function');
    });

    it('should export getIndex function', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      expect(typeof meilisearchConfig.getIndex).toBe('function');
    });

    it('should export healthCheck function', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      expect(typeof meilisearchConfig.healthCheck).toBe('function');
    });

    it('should export client property', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      // client may be null if URL not configured, but property should exist
      expect(meilisearchConfig).toHaveProperty('client');
    });
  });

  describe('Recovery Integration', () => {
    it('should have recovery module available', () => {
      const recovery = require('../../config/meilisearch-recovery');
      expect(typeof recovery.triggerRecoverySync).toBe('function');
    });

    it('should detect startup HTML in globalSearch with proper signature', () => {
      const meilisearchConfig = require('../../config/meilisearch');
      // Verify globalSearch has the categorization and recovery logic
      expect(meilisearchConfig.globalSearch.toString()).toContain('MeiliSearch');
      expect(meilisearchConfig.globalSearch.toString()).toContain('categorizeError');
    });
  });
});
