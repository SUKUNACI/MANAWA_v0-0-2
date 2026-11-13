'use strict';
/**
 * Tests for config/database-replication.js
 */

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: jest.fn().mockResolvedValue([{ replay_lag: null }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('database-replication config', () => {
  let replication;
  let PrismaClientMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@prisma/client', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $queryRaw: jest.fn().mockResolvedValue([]),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      })),
    }));
    replication = require('../../config/database-replication');
    PrismaClientMock = require('@prisma/client').PrismaClient;
  });

  describe('état initial', () => {
    it('a un état de réplication initial', () => {
      expect(replication.replicationStatus).toBeDefined();
      expect(replication.replicationStatus.primary.connected).toBe(false);
      expect(replication.readReplicaPrismas).toEqual([]);
    });
  });

  describe('initPrimary', () => {
    it('retourne false si DATABASE_PRIMARY_URL et DATABASE_URL sont absents', async () => {
      const savedUrl = process.env.DATABASE_URL;
      const savedPrimary = process.env.DATABASE_PRIMARY_URL;
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_PRIMARY_URL;
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockRejectedValue(new Error('no url')),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const result = await rep.initPrimary();
      expect(result).toBe(false);
      process.env.DATABASE_URL = savedUrl;
      if (savedPrimary) process.env.DATABASE_PRIMARY_URL = savedPrimary;
    });

    it('retourne true si la connexion réussit', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const result = await rep.initPrimary();
      expect(result).toBe(true);
      expect(rep.replicationStatus.primary.connected).toBe(true);
    });

    it('retourne false si Prisma throw', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockRejectedValue(new Error('Connection refused')),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const result = await rep.initPrimary();
      expect(result).toBe(false);
      expect(rep.replicationStatus.primary.connected).toBe(false);
    });
  });

  describe('initReadReplicas', () => {
    it('log un warning si DATABASE_REPLICA_URLS est absent', async () => {
      delete process.env.DATABASE_REPLICA_URLS;
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      await expect(rep.initReadReplicas()).resolves.not.toThrow();
      expect(rep.readReplicaPrismas).toHaveLength(0);
    });

    it('connecte les replicas si DATABASE_REPLICA_URLS est défini', async () => {
      process.env.DATABASE_REPLICA_URLS = 'postgresql://test:test@replica1:5432/testdb';
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      await rep.initReadReplicas();
      expect(rep.readReplicaPrismas.length).toBe(1);
      expect(rep.readReplicaPrismas[0].connected).toBe(true);
      delete process.env.DATABASE_REPLICA_URLS;
    });

    it('marque le replica comme non-connecté si la connexion échoue', async () => {
      process.env.DATABASE_REPLICA_URLS = 'postgresql://bad:url@nowhere:5432/db';
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockRejectedValue(new Error('Replica down')),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      await rep.initReadReplicas();
      expect(rep.replicationStatus.replicas['replica-0'].connected).toBe(false);
      delete process.env.DATABASE_REPLICA_URLS;
    });
  });

  describe('getReadReplica', () => {
    it('utilise primaryPrisma si aucun replica', () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const mockPrimary = { connected: true };
      rep.primaryPrisma = mockPrimary;
      rep.readReplicaPrismas = [];
      const result = rep.getReadReplica();
      expect(result).toBe(mockPrimary);
    });

    it('retourne un replica connecté via round-robin', () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const mockReplica1 = { prisma: { query: jest.fn() }, connected: true };
      const mockReplica2 = { prisma: { query: jest.fn() }, connected: true };
      rep.readReplicaPrismas = [mockReplica1, mockReplica2];
      rep.readReplicaIndex = 0;
      const result = rep.getReadReplica();
      expect(result).toBe(mockReplica1.prisma);
    });

    it('saute les replicas non-connectés', () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const mockPrimary = { connected: true };
      const downReplica = { prisma: {}, connected: false };
      rep.primaryPrisma = mockPrimary;
      rep.readReplicaPrismas = [downReplica];
      rep.readReplicaIndex = 0;
      const result = rep.getReadReplica();
      expect(result).toBe(mockPrimary);
    });
  });

  describe('getStatus', () => {
    it('retourne le statut de réplication', () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      const status = rep.getStatus();
      expect(status).toHaveProperty('primary');
      expect(status).toHaveProperty('replicas');
      expect(Array.isArray(status.replicas)).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('déconnecte toutes les connexions', async () => {
      jest.resetModules();
      const mockDisconnect = jest.fn().mockResolvedValue(undefined);
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: mockDisconnect,
        })),
      }));
      const rep = require('../../config/database-replication');
      rep.primaryPrisma = { $disconnect: mockDisconnect };
      rep.readReplicaPrismas = [
        { prisma: { $disconnect: mockDisconnect } },
      ];
      await rep.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('ne lance pas si primaryPrisma est null', async () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      const rep = require('../../config/database-replication');
      rep.primaryPrisma = null;
      rep.readReplicaPrismas = [];
      await expect(rep.disconnect()).resolves.not.toThrow();
    });
  });
});
