'use strict';
/**
 * Tests for config/backup-strategy.js
 */

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('SQL DUMP')),
  statSync: jest.fn().mockReturnValue({ size: 1024 }),
}));

describe('backup-strategy config', () => {
  let backup;
  let fsMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@prisma/client', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $queryRaw: jest.fn().mockResolvedValue([
          { tablename: 'users' },
        ]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        ]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      })),
    }));
    jest.mock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
      readFileSync: jest.fn().mockReturnValue(Buffer.from('SQL DUMP')),
      statSync: jest.fn().mockReturnValue({ size: 1024 }),
    }));
    backup = require('../../config/backup-strategy');
    fsMock = require('fs');
  });

  describe('état initial', () => {
    it('exporte une instance de BackupStrategy', () => {
      expect(backup).toBeDefined();
      expect(typeof backup).toBe('object');
    });

    it('a les propriétés de configuration', () => {
      expect(typeof backup.backupBucket).toBe('string');
      expect(typeof backup.backupRetentionDays).toBe('number');
      expect(backup.backupSchedule).toHaveProperty('fullBackup');
      expect(backup.backupSchedule).toHaveProperty('incrementalBackupInterval');
    });

    it('backupBucket par défaut est manawa-db-backups', () => {
      expect(backup.backupBucket).toBe('manawa-db-backups');
    });

    it('backupRetentionDays par défaut est 30', () => {
      expect(backup.backupRetentionDays).toBe(30);
    });
  });

  describe('initializeS3', () => {
    it('retourne false si aws-sdk n\'est pas disponible', () => {
      // aws-sdk n'est pas installé dans ce projet
      const result = backup.initializeS3();
      expect(result).toBe(false);
    });
  });

  describe('ensureBackupDir', () => {
    it('crée le répertoire s\'il n\'existe pas', () => {
      fsMock.existsSync.mockReturnValueOnce(false);
      backup.ensureBackupDir();
      expect(fsMock.mkdirSync).toHaveBeenCalledWith(
        backup.localBackupDir,
        { recursive: true }
      );
    });

    it('ne crée pas le répertoire s\'il existe déjà', () => {
      fsMock.existsSync.mockReturnValueOnce(true);
      fsMock.mkdirSync.mockClear();
      backup.ensureBackupDir();
      expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    });

    it('gère les erreurs sans lancer', () => {
      fsMock.existsSync.mockReturnValueOnce(false);
      fsMock.mkdirSync.mockImplementationOnce(() => { throw new Error('Permission denied'); });
      expect(() => backup.ensureBackupDir()).not.toThrow();
    });
  });

  describe('getTransactionLog', () => {
    it('retourne une chaîne vide en cas d\'erreur DB', async () => {
      jest.resetModules();
      jest.mock('@prisma/client', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $queryRaw: jest.fn().mockRejectedValue(new Error('Table not found')),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      jest.mock('fs', () => ({
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn().mockReturnValue(Buffer.from('')),
        statSync: jest.fn().mockReturnValue({ size: 0 }),
      }));
      const bk = require('../../config/backup-strategy');
      const result = await bk.getTransactionLog();
      expect(typeof result).toBe('string');
    });
  });

  describe('applyChange', () => {
    it('gère une opération de change sans lancer', async () => {
      const mockPrisma = {};
      const change = { operation: 'INSERT', entity_type: 'User', entity_id: '1', changes: {} };
      await expect(backup.applyChange(mockPrisma, change)).resolves.not.toThrow();
    });
  });

  describe('variables d\'environnement', () => {
    it('BACKUP_S3_BUCKET configure le bucket', () => {
      jest.resetModules();
      process.env.BACKUP_S3_BUCKET = 'my-custom-bucket';
      jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn().mockImplementation(() => ({})) }));
      jest.mock('fs', () => ({ existsSync: jest.fn().mockReturnValue(true), mkdirSync: jest.fn(), writeFileSync: jest.fn(), readFileSync: jest.fn().mockReturnValue(Buffer.from('')), statSync: jest.fn().mockReturnValue({ size: 0 }) }));
      const bk = require('../../config/backup-strategy');
      expect(bk.backupBucket).toBe('my-custom-bucket');
      delete process.env.BACKUP_S3_BUCKET;
    });

    it('BACKUP_RETENTION_DAYS configure la rétention', () => {
      jest.resetModules();
      process.env.BACKUP_RETENTION_DAYS = '90';
      jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn().mockImplementation(() => ({})) }));
      jest.mock('fs', () => ({ existsSync: jest.fn().mockReturnValue(true), mkdirSync: jest.fn(), writeFileSync: jest.fn(), readFileSync: jest.fn().mockReturnValue(Buffer.from('')), statSync: jest.fn().mockReturnValue({ size: 0 }) }));
      const bk = require('../../config/backup-strategy');
      expect(bk.backupRetentionDays).toBe(90);
      delete process.env.BACKUP_RETENTION_DAYS;
    });
  });
});
