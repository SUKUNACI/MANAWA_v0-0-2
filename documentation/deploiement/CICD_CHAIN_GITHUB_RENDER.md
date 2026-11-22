# Chaîne CI/CD GitHub Actions → Render

## Architecture de la chaîne

```
push to main
     │
     ▼
┌────────────┐  ┌──────────────────┐
│    test    │  │    gitleaks      │
│            │  │  (Scan for       │
│ Tests 75%  │  │   secrets)       │
│ coverage   │  │  SARIF → GitHub  │
│    gate    │  │  Security        │
└─────┬──────┘  └───────┬──────────┘
      │                  │
      └────────┬──────────┘
               │  (both required)
               ▼
        ┌────────────┐
        │   deploy   │
        │            │
        │ 1. Trigger │
        │    Render  │
        │    API v1  │
        │ 2. Poll    │
        │    + SHA   │
        │    verify  │
        │ 3. Health  │
        │    check   │
        └────────────┘
```

**Règle fondamentale :** le déploiement en production ne se déclenche que si, et seulement si, les deux contrôles obligatoires réussissent — aucune exception possible par construction YAML.

---

## Workflow : `.github/workflows/ci.yml`

### Job `test` — Tests & Coverage Gate (75%)

- Runner : `ubuntu-latest`
- Services : PostgreSQL 15 + Redis 7
- Étapes : `npm ci` → `prisma generate` → `prisma db push` → tests → gate 75%
- Artefact : rapport de couverture (toujours uploadé)

### Job `gitleaks` — Scan for secrets

- Runner : `ubuntu-latest`
- Action : `gitleaks/gitleaks-action@v3` (Node 24)
- Checkout : `actions/checkout@v6` avec `fetch-depth: 0` (historique complet)
- SARIF : publié dans GitHub Security (onglet **Security → Code scanning**)
- Nom du contrôle : **`Scan for secrets`** (invariant — utilisé dans les branch protections)

### Job `deploy` — Deploy to Production

- **Dépendances :** `needs: [test, gitleaks]`
- **Condition :** `github.ref == 'refs/heads/main' && github.event_name == 'push'`
  - N'est jamais déclenché sur PR, sur push vers `develop`/`masterchef`, ni en cas d'échec de `test` ou `gitleaks`
- **Concurrence :** `group: production-deploy`, `cancel-in-progress: false`
  - Un seul déploiement simultané autorisé
  - Un déploiement en cours n'est jamais annulé par un push suivant

#### Étape 1 — Trigger Render deployment

- Appel : `POST https://api.render.com/v1/services/{serviceId}/deploys`
- Corps : `{"commitId": "<github.sha>"}`
- Réponse : `{"id": "<deployId>", "status": "created", "commit": {"id": "<sha>"}, ...}`
- Output : `deploy_id` transmis à l'étape suivante via `GITHUB_OUTPUT`

#### Étape 2 — Wait for deployment to complete

- Polling : `GET https://api.render.com/v1/services/{serviceId}/deploys/{deployId}`
- Intervalle : 10 secondes
- Timeout : 90 tentatives × 10 s = **15 minutes**
- Statuts terminaux :
  - `live` → succès — vérification SHA obligatoire (`deploy.commit.id == github.sha`)
  - `build_failed` / `update_failed` / `pre_deploy_failed` / `canceled` / `deactivated` → échec
- Garantie SHA : si `deploy.commit.id` ne correspond pas à `github.sha`, le job échoue même si le statut est `live`

#### Étape 3 — Health check

- Récupère l'URL du service via `GET https://api.render.com/v1/services/{serviceId}`
- Appelle `{serviceUrl}/api/v1/health`
- Échec si la réponse n'est pas HTTP 2xx (comportement de `curl -sf`)

---

## Configuration externe requise

Ces étapes **doivent être effectuées manuellement** avant que la chaîne soit opérationnelle.

### 1. Désactiver l'auto-deploy sur Render

`render.yaml` contient `autoDeploy: false`. Après la prochaine synchronisation du Blueprint, Render ne déploiera plus automatiquement sur push — seul le job `deploy` de GitHub Actions déclenchera les déploiements.

**Vérification manuelle :** Dashboard Render → Service `manawa-api` → Settings → Auto-Deploy → doit être `No`.

### 2. Créer le secret `RENDER_API_KEY`

1. Dashboard Render → Account Settings → API Keys → **Create API Key**
2. Copier la valeur (affichée une seule fois)
3. GitHub → Settings → Secrets and variables → Actions → **New repository secret**
   - Nom : `RENDER_API_KEY`
   - Valeur : la clé Render

### 3. Créer le secret `RENDER_SERVICE_ID`

1. Dashboard Render → Service `manawa-api` → Settings → Service ID (format `srv-...`)
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**
   - Nom : `RENDER_SERVICE_ID`
   - Valeur : l'ID du service (ex. `srv-abc123def456`)

### 4. Vérifier les branch protections GitHub (optionnel mais recommandé)

GitHub → Settings → Branches → Protection rule pour `main` :

- [x] Require status checks to pass before merging
  - `Tests & Coverage Gate (80%)`
  - `Scan for secrets`

Le job `deploy` n'est **pas** à inclure comme required check (il tourne uniquement sur push, pas sur PR).

---

## Secrets GitHub utilisés

| Secret | Usage | Sensibilité |
|--------|-------|-------------|
| `RENDER_API_KEY` | Authentification API Render v1 | Haute — accès complet au compte Render |
| `RENDER_SERVICE_ID` | Identifie le service cible | Faible — ID non confidentiel |
| `CI_JWT_SECRET` | JWT pour les tests CI | Moyenne — environnement test uniquement |

---

## Comportement selon le déclencheur

| Déclencheur | `test` | `gitleaks` | `deploy` |
|-------------|--------|------------|---------|
| Push `main` | Oui | Oui | Oui (si les deux réussissent) |
| Push `develop` | Oui | Oui | Non (condition `main` non satisfaite) |
| Push `masterchef` | Oui | Oui | Non (condition `main` non satisfaite) |
| PR vers `main` | Oui | Oui | Non (`event_name == 'pull_request'`) |
| `test` échoue | Oui (failed) | Oui | Non (`needs` non satisfait) |
| `gitleaks` échoue | Oui | Oui (failed) | Non (`needs` non satisfait) |

---

## Garanties de sécurité de la chaîne

1. **Aucun déploiement sans tests verts** — `needs: [test, gitleaks]` est une contrainte YAML, pas un check logiciel.
2. **Aucun déploiement avec secrets leakés** — Gitleaks bloque le pipeline avant le déploiement.
3. **Déploiement ciblé sur un SHA précis** — `commitId: github.sha` dans le trigger + vérification `deploy.commit.id` après `live`.
4. **Pas de déploiement concurrent** — `concurrency.cancel-in-progress: false` protège un déploiement en cours.
5. **Déploiement uniquement depuis `main`** — la condition `if:` est évaluée par GitHub Actions avant que le job ne démarre.
6. **Auto-deploy Render désactivé** — `autoDeploy: false` empêche tout déploiement direct depuis Render hors de ce pipeline.
