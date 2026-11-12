#!/bin/bash
# Q118: Database migration strategy
# Exécuté en build command sur Render AVANT le démarrage du serveur.
# Render build command: npm install && bash scripts/migrate-deploy.sh
#
# Ce script applique les migrations Prisma en production de façon sécurisée :
# - Ne crée PAS de nouvelles migrations (commande réservée au développement local uniquement)
# - Applique uniquement les migrations déjà commitées dans prisma/migrations/
# - Génère le client Prisma après migration
# - Vérifie la connexion DB avant de continuer

set -euo pipefail

echo "=== MANAWA — Database Migration (Q118) ==="
echo "Environment: ${NODE_ENV:-production}"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL not set"
  exit 1
fi

echo ""
echo "1/3 — Applying pending migrations..."
npx prisma migrate deploy
echo "Migrations applied"

echo ""
echo "2/3 — Generating Prisma client..."
npx prisma generate
echo "Prisma client generated"

echo ""
echo "3/3 — Verifying database connection..."
node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$queryRaw\`SELECT 1\`
    .then(() => { console.log('Database connection OK'); process.exit(0); })
    .catch(err => { console.error('Database connection FAILED:', err.message); process.exit(1); })
    .finally(() => prisma.\$disconnect());
"

echo ""
echo "=== Migration complete — server ready to start ==="
