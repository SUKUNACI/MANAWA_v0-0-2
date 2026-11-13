'use strict';
/**
 * Tests for config/meilisearch.js
 */

const mockIndex = {
  search: jest.fn().mockResolvedValue({ hits: [] }),
  updateSearchableAttributes: jest.fn().mockResolvedValue({}),
  updateFilterableAttributes: jest.fn().mockResolvedValue({}),
  updateSortableAttributes: jest.fn().mockResolvedValue({}),
};

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn().mockImplementation(() => ({
    getIndex: jest.fn().mockResolvedValue(mockIndex),
    createIndex: jest.fn().mockResolvedValue({}),
    index: jest.fn().mockReturnValue(mockIndex),
    health: jest.fn().mockResolvedValue({ status: 'available' }),
  })),
}));

describe('meilisearch config', () => {
  let ms;
  let meilisearchClientMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('meilisearch', () => ({
      MeiliSearch: jest.fn().mockImplementation(() => ({
        getIndex: jest.fn().mockResolvedValue(mockIndex),
        createIndex: jest.fn().mockResolvedValue({}),
        index: jest.fn().mockReturnValue(mockIndex),
        health: jest.fn().mockResolvedValue({ status: 'available' }),
      })),
    }));
    ms = require('../../config/meilisearch');
  });

  describe('exports', () => {
    it('exporte client, getIndex, ensureIndices, healthCheck, globalSearch, INDICES_CONFIG', () => {
      expect(ms.client).toBeDefined();
      expect(typeof ms.getIndex).toBe('function');
      expect(typeof ms.ensureIndices).toBe('function');
      expect(typeof ms.healthCheck).toBe('function');
      expect(typeof ms.globalSearch).toBe('function');
      expect(ms.INDICES_CONFIG).toBeDefined();
    });
  });

  describe('INDICES_CONFIG', () => {
    it('contient tous les indices requis', () => {
      const { INDICES_CONFIG } = ms;
      expect(INDICES_CONFIG).toHaveProperty('professionals');
      expect(INDICES_CONFIG).toHaveProperty('projects');
      expect(INDICES_CONFIG).toHaveProperty('portfolio');
      expect(INDICES_CONFIG).toHaveProperty('packages');
      expect(INDICES_CONFIG).toHaveProperty('reviews');
    });

    it('chaque indice a name, primaryKey, searchableAttributes', () => {
      const { INDICES_CONFIG } = ms;
      for (const key of Object.keys(INDICES_CONFIG)) {
        expect(INDICES_CONFIG[key]).toHaveProperty('name');
        expect(INDICES_CONFIG[key]).toHaveProperty('primaryKey', 'id');
        expect(Array.isArray(INDICES_CONFIG[key].searchableAttributes)).toBe(true);
        expect(Array.isArray(INDICES_CONFIG[key].filterableAttributes)).toBe(true);
        expect(Array.isArray(INDICES_CONFIG[key].sortableAttributes)).toBe(true);
      }
    });

    it('l\'indice professionals a les bons attributs de recherche', () => {
      const { searchableAttributes } = ms.INDICES_CONFIG.professionals;
      expect(searchableAttributes).toContain('firstName');
      expect(searchableAttributes).toContain('lastName');
      expect(searchableAttributes).toContain('trade');
    });
  });

  describe('getIndex', () => {
    it('retourne l\'indice pour un nom valide', () => {
      const index = ms.getIndex('professionals');
      expect(index).toBeDefined();
    });

    it('lance une erreur pour un indice inconnu', () => {
      expect(() => ms.getIndex('unknown_index')).toThrow('Indice MeiliSearch inconnu: unknown_index');
    });

    it('retourne un indice pour chaque nom configuré', () => {
      for (const indexName of Object.keys(ms.INDICES_CONFIG)) {
        expect(() => ms.getIndex(indexName)).not.toThrow();
      }
    });
  });

  describe('healthCheck', () => {
    it('retourne status ok si MeiliSearch est disponible', async () => {
      const result = await ms.healthCheck();
      expect(result).toHaveProperty('status');
      expect(typeof result.status).toBe('string');
    });

    it('retourne status error si MeiliSearch est indisponible', async () => {
      jest.resetModules();
      jest.mock('meilisearch', () => ({
        MeiliSearch: jest.fn().mockImplementation(() => ({
          health: jest.fn().mockRejectedValue(new Error('Connection refused')),
          index: jest.fn().mockReturnValue(mockIndex),
          getIndex: jest.fn(),
          createIndex: jest.fn(),
        })),
      }));
      const msErr = require('../../config/meilisearch');
      const result = await msErr.healthCheck();
      expect(result.status).toBe('error');
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('ensureIndices', () => {
    it('configure tous les indices sans erreur', async () => {
      await expect(ms.ensureIndices()).resolves.toBe(true);
    });

    it('crée l\'indice s\'il n\'existe pas (index_not_found)', async () => {
      jest.resetModules();
      const mockIdx = {
        updateSearchableAttributes: jest.fn().mockResolvedValue({}),
        updateFilterableAttributes: jest.fn().mockResolvedValue({}),
        updateSortableAttributes: jest.fn().mockResolvedValue({}),
      };
      jest.mock('meilisearch', () => ({
        MeiliSearch: jest.fn().mockImplementation(() => ({
          getIndex: jest.fn()
            .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'index_not_found' }))
            .mockResolvedValue(mockIdx),
          createIndex: jest.fn().mockResolvedValue({}),
          index: jest.fn().mockReturnValue(mockIdx),
          health: jest.fn().mockResolvedValue({ status: 'available' }),
        })),
      }));
      const msNew = require('../../config/meilisearch');
      await expect(msNew.ensureIndices()).resolves.toBe(true);
    });

    it('lance une erreur si l\'erreur n\'est pas index_not_found', async () => {
      jest.resetModules();
      jest.mock('meilisearch', () => ({
        MeiliSearch: jest.fn().mockImplementation(() => ({
          getIndex: jest.fn().mockRejectedValue(new Error('Fatal error')),
          createIndex: jest.fn(),
          index: jest.fn().mockReturnValue(mockIndex),
          health: jest.fn(),
        })),
      }));
      const msErr = require('../../config/meilisearch');
      await expect(msErr.ensureIndices()).rejects.toThrow('Fatal error');
    });
  });

  describe('globalSearch', () => {
    it('retourne les résultats de tous les indices', async () => {
      const results = await ms.globalSearch('test query');
      expect(results).toHaveProperty('professionals');
      expect(results).toHaveProperty('projects');
      expect(results).toHaveProperty('portfolio');
      expect(results).toHaveProperty('packages');
      expect(results).toHaveProperty('reviews');
    });

    it('gère les erreurs par indice avec hits vide', async () => {
      jest.resetModules();
      const mockFailingIndex = {
        search: jest.fn().mockRejectedValue(new Error('Index unavailable')),
        updateSearchableAttributes: jest.fn(),
        updateFilterableAttributes: jest.fn(),
        updateSortableAttributes: jest.fn(),
      };
      jest.mock('meilisearch', () => ({
        MeiliSearch: jest.fn().mockImplementation(() => ({
          getIndex: jest.fn().mockResolvedValue(mockFailingIndex),
          createIndex: jest.fn(),
          index: jest.fn().mockReturnValue(mockFailingIndex),
          health: jest.fn().mockResolvedValue({ status: 'available' }),
        })),
      }));
      const msErr = require('../../config/meilisearch');
      const results = await msErr.globalSearch('query');
      expect(results.professionals.hits).toEqual([]);
    });
  });
});
