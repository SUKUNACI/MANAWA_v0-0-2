const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class KeyVersioningModule {
  /**
   * Récupère la clé active pour un keyName donné
   * @param {string} keyName - JWT_SECRET, DB_ENCRYPTION_KEY, etc.
   * @returns {Promise<Object>} Active KeyVersion ou null
   */
  static async getActiveKey(keyName) {
    return prisma.keyVersion.findFirst({
      where: {
        keyName,
        isActive: true,
      },
    });
  }

  /**
   * Récupère une version de clé spécifique par keyName et version
   * @param {string} keyName - Nom de la clé
   * @param {number} version - Numéro de version
   * @returns {Promise<Object>} KeyVersion ou null
   */
  static async getKeyVersion(keyName, version) {
    return prisma.keyVersion.findUnique({
      where: {
        keyName_version: { keyName, version },
      },
    });
  }

  /**
   * Crée une nouvelle version de clé
   * @param {string} keyName - Nom de la clé
   * @param {string} algorithm - AES-256-GCM, RSA-4096, HMAC-SHA256, etc.
   * @returns {Promise<Object>} KeyVersion créée
   */
  static async createKeyVersion(keyName, algorithm) {
    // Récupère la prochaine version (dernière version + 1)
    const lastVersion = await prisma.keyVersion.findFirst({
      where: { keyName },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version || 0) + 1;

    // Crée la nouvelle version (pas encore active)
    const keyVersion = await prisma.keyVersion.create({
      data: {
        keyName,
        version: nextVersion,
        algorithm,
        isActive: false,
      },
    });

    return keyVersion;
  }

  /**
   * Active une version de clé (désactive la précédente)
   * @param {string} keyName - Nom de la clé
   * @param {number} version - Version à activer
   * @returns {Promise<Object>} KeyVersion activée
   */
  static async activateKeyVersion(keyName, version) {
    // Désactive la clé active actuelle
    await prisma.keyVersion.updateMany({
      where: {
        keyName,
        isActive: true,
      },
      data: { isActive: false },
    });

    // Active la nouvelle version
    const activated = await prisma.keyVersion.update({
      where: {
        keyName_version: { keyName, version },
      },
      data: { isActive: true },
    });

    return activated;
  }

  /**
   * Récupère toutes les versions d'une clé
   * @param {string} keyName - Nom de la clé
   * @returns {Promise<Array>} Toutes les versions (triées par version DESC)
   */
  static async getAllVersions(keyName) {
    return prisma.keyVersion.findMany({
      where: { keyName },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Marque une clé comme expirée (mais garde pour déchiffrer les anciennes données)
   * @param {string} keyName - Nom de la clé
   * @param {number} version - Version
   * @param {Date} expiresAt - Date d'expiration
   * @returns {Promise<Object>} KeyVersion mise à jour
   */
  static async setKeyExpiration(keyName, version, expiresAt) {
    return prisma.keyVersion.update({
      where: {
        keyName_version: { keyName, version },
      },
      data: { expiresAt },
    });
  }

  /**
   * Déchiffre les anciennes données avec la bonne version de clé
   * @param {string} keyName - Nom de la clé
   * @param {number} version - Version de la clé utilisée
   * @param {string} encryptedData - Données chiffrées
   * @returns {Promise<string>} Données déchiffrées
   * Note: Implémentation réelle dépend du stockage de la clé (env var, secrets manager, etc.)
   */
  static async decryptWithVersion(keyName, version, encryptedData) {
    const keyVersion = await this.getKeyVersion(keyName, version);
    if (!keyVersion) {
      throw new Error(`Key version not found: ${keyName} v${version}`);
    }

    // TODO: Récupérer la clé réelle du secrets manager
    // const key = await getKeyFromSecretsManager(keyName, version)
    // return decrypt(key, encryptedData, keyVersion.algorithm)

    return encryptedData; // Placeholder
  }

  /**
   * Crée et active une nouvelle version de clé en une seule opération
   * @param {string} keyName - Nom de la clé
   * @param {string} algorithm - Algorithme (ex: AES-256-GCM)
   * @returns {Promise<Object>} Nouvelle version active
   */
  static async createAndActivateKeyVersion(keyName, algorithm) {
    const newVersion = await this.createKeyVersion(keyName, algorithm);
    return this.activateKeyVersion(keyName, newVersion.version);
  }

  /**
   * Effectue la rotation vers une nouvelle version (alias pour createAndActivateKeyVersion)
   * @deprecated Utilisez createAndActivateKeyVersion à la place
   * @param {string} keyName - Nom de la clé
   * @param {string} algorithm - Algorithme (ex: AES-256-GCM)
   * @returns {Promise<Object>} Nouvelle version active
   */
  static async rotateToNewVersion(keyName, algorithm) {
    return this.createAndActivateKeyVersion(keyName, algorithm);
  }

  /**
   * Vérifie la santé du système de clés
   * @returns {Promise<Object>} État du système { healthy, issues }
   */
  static async healthCheck() {
    const issues = [];
    const criticalKeys = ['JWT_SECRET', 'DB_ENCRYPTION_KEY', 'API_ENCRYPTION_KEY'];

    // Check critical keys + multiple active detection in one query
    const activeKeysByName = await prisma.keyVersion.groupBy({
      by: ['keyName'],
      where: { isActive: true },
      _count: { id: true },
    });

    const activeKeyMap = Object.fromEntries(activeKeysByName.map(k => [k.keyName, k._count.id]));

    for (const keyName of criticalKeys) {
      const count = activeKeyMap[keyName] || 0;
      if (count === 0) {
        issues.push(`No active key found for ${keyName}`);
      } else if (count > 1) {
        issues.push(`Multiple active keys found for ${keyName} (${count})`);
      }
    }

    return { healthy: issues.length === 0, issues };
  }
}

module.exports = KeyVersioningModule;
