# MANAWA — Staging Environment (Q115)

## Configuration Render Staging

Créer un second Web Service Render identique à la production avec :

```
Service Name : manawa-api-staging
Branch       : main (auto-deploy on push)
Build Command: npm install && bash scripts/migrate-deploy.sh
Start Command: node index.js
Plan         : Starter ($7/month)
Region       : Oregon (ou Frankfurt)
```

## Variables d'environnement staging

```
NODE_ENV=staging
DATABASE_URL=postgresql://...staging_db...
REDIS_URL=redis://...staging_redis...
JWT_SECRET=<secret staging distinct du prod>
CORS_ORIGINS=https://staging.manawa.app
MAILJET_API_KEY=<clé sandbox Mailjet>
MAILJET_SECRET_KEY=<secret sandbox Mailjet>
SENTRY_DSN=<DSN Sentry staging project>
```

## GitHub Secrets à configurer (Settings → Secrets → Actions)

| Secret | Valeur |
|--------|--------|
| `RENDER_DEPLOY_HOOK_STAGING` | URL du deploy hook Render staging |
| `RENDER_DEPLOY_HOOK_PROD`    | URL du deploy hook Render production |
| `RENDER_DEPLOY_HOOK_PREV`    | URL du deploy hook version N-1 (rollback) |
| `STAGING_URL`                | `https://manawa-api-staging.onrender.com` |
| `PRODUCTION_URL`             | `https://manawa-api.onrender.com` |

## Pipeline complet (ci.yml)

```
push → main
  ├── test          (Jest + coverage gate 80%)
  ├── secrets-scan  (Gitleaks + ESLint)
  ├── performance   (health < 500ms)
  ├── deploy-staging
  │     ├── Trigger Render staging hook
  │     ├── Wait for /health → 200
  │     └── Smoke tests
  └── deploy-production
        ├── Trigger Render prod hook
        ├── Wait for /health → 200
        ├── Smoke tests
        └── [on failure] Auto-rollback via RENDER_DEPLOY_HOOK_PREV
```

## Q117 — Zero-downtime deployment

Render effectue un rolling deployment natif :
1. Démarre le nouveau container
2. Attend que le health check `/api/v1/health` réponde 200
3. Bascule le trafic vers le nouveau container
4. Arrête l'ancien container avec SIGTERM → graceful shutdown

Le graceful shutdown dans `backend/index.js` (déjà implémenté ligne 822) :
- Écoute `SIGTERM`
- Ferme `server.close()` — attend la fin des requêtes en cours
- Arrête les workers Bull
- Déconnecte Redis
- Quitte proprement avec `process.exit(0)`

## Q118 — Database migration strategy

Render build command :
```
npm install && bash scripts/migrate-deploy.sh
```

`scripts/migrate-deploy.sh` exécute dans l'ordre :
1. `prisma migrate deploy` — applique les migrations commitées
2. `prisma generate` — régénère le client Prisma
3. Vérifie la connexion DB via `SELECT 1`

**Règle absolue :** jamais de `prisma migrate dev` en production ou staging.

## Q119 — Rollback procedures

### Rollback automatique (CI/CD)
Si les smoke tests production échouent, le pipeline déclenche automatiquement
`RENDER_DEPLOY_HOOK_PREV` pour redéployer la version précédente.

### Rollback manuel
```bash
# Option 1 : revert du commit et push
git revert HEAD && git push origin main

# Option 2 : Render dashboard
# Services → manawa-api → Deploys → déploiement précédent → Redeploy

# Option 3 : script existant
bash backend/scripts/rollback-trigger.sh --once
```

### Rollback de migration DB (urgence uniquement)
```bash
npx prisma migrate resolve --rolled-back <nom_de_la_migration>
```
