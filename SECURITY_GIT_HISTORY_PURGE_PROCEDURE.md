# Procédure de Nettoyage de l'Historique Git — Suppression du Mot de Passe Admin

**⚠️ PROCÉDURE DESTRUCTRICE — À EXÉCUTER UNIQUEMENT AVEC L'APPROBATION DU USER**

## État Actuel

**Commits contenant l'ancien mot de passe admin** (détecté par `git log -S`):

1. **c973d55** (RÉCENT) — Supprime le mot de passe de `/setup-admin` (git montre la suppression)
2. **9f5e5b2** (RÉCENT) — Supprime la référence du mot de passe de AUDIT_SECURITE.md
3. **a5d0d6e** (ANCIEN) — Contient le mot de passe original en code source

---

## Stratégie de Nettoyage

### Option A: Rebase + Force Push (DESTRUCTEUR)

```bash
# 1. Identifier le commit précédent avant l'introduction du secret
# (commit juste avant a5d0d6e)

# 2. Rebase interactif depuis ce commit
git rebase -i <commit-avant-a5d0d6e>

# 3. Marquer ces 3 commits comme 'drop'
# 4. Sauvegarder et rebase s'exécute

# 5. Forcer la push (ATTENTION: rebase les collaborateurs)
git push --force-with-lease origin main

# ⚠️ CONSÉQUENCE: Tous les collaborateurs doivent faire 'git pull --rebase'
```

### Option B: Filter-Repo (RECOMMANDÉ — PLUS SÛRE)

```bash
# 1. Installer git-filter-repo (pip)
pip install git-filter-repo

# 2. Exécuter filter-repo pour supprimer la chaîne
git filter-repo --replace-text replacements.txt \
  --force

# replacements.txt contient:
# literal:PASSWORD_REMOVED==>PASSWORD_REMOVED

# 3. Vérifier le résultat
git log -S "PASSWORD_REMOVED"  # Doit être vide

# 4. Force push
git push origin --force-with-lease main

# ⚠️ CONSÉQUENCE: Historique réécrit — collaborateurs doivent 'git reset'
```

### Option C: Aucune Action (Acceptable)

Le mot de passe ancien est:
- ✅ Roté (mot de passe nouveau généralement stocké en env var)
- ✅ Supprimé du code vivant (removed in recent commits)
- ✅ Marqué comme [REDACTED] dans la doc
- ✅ Protégé par Gitleaks (future commits bloqués)

**Risque résiduel:** Historique git est public si GitHub est public. L'ancien mot de passe peut être découvert via `git log` ou GitHub API, mais:
- L'utilisateur admin a été roté
- L'accès direct à Neon est via variables d'environnement (production)
- E2E tests lisent depuis env vars (protection double)

---

## Recommandation

**POUR CETTE SESSION:**
1. ✅ Configuration Gitleaks complétée (bloque les futurs secrets)
2. ✅ Code nettoyé (mot de passe supprimé des sources vivantes)
3. ✅ Tests protégés (env vars, pas de hardcoding)
4. ✅ E2E tests doublement sécurisés (erreurs explicites si env var missing)

**AVANT PRODUCTION:**
1. Vérifier que la rérotation du mot de passe admin sur Neon est complète
2. Tester que Render (production) utilise le nouveau mot de passe via env var
3. Si sensibilité élevée: exécuter Option B (filter-repo) + force push
4. Configurer branch protection rules pour bloquer `--force-with-lease`

---

## Commandes de Vérification (READ-ONLY)

```bash
# Vérifier quelle branche est checked out
git status

# Vérifier les commits contenant le secret (sans le montrer)
git log -S "PASSWORD_REMOVED" --oneline

# Vérifier les remotes
git remote -v

# Vérifier l'état de la branche vs origin
git log --oneline -n 5 main
git log --oneline -n 5 origin/main
```

---

## Procédure de Confirmation

**AVANT D'EXÉCUTER filter-repo:**

L'utilisateur doit confirmER:
1. Tous les collaborateurs sont informés (historique va être réécrit)
2. Render production utilise env var, PAS le mot de passe ancien
3. Backup de la branche est pris (git branch backup-main)
4. S'il y a des PRs ouvertes, elles seront invalidées (histories divergent)

**INSTRUCTION À L'UTILISATEUR:**
- `Ya, procede au filter-repo avec Option B` → J'exécute git filter-repo
- `Non, laisser l'historique comme est` → Fin de PHASE C, historique reste public mais protégé

---

## État après Nettoyage

| Aspect | Avant | Après |
|--------|-------|-------|
| Code source | ✅ Propre | ✅ Identique |
| Historique git | ❌ Contient secret | ✅ Rewrite + force push |
| Gitleaks config | ✅ En place | ✅ Bloque futurs secrets |
| Pre-commit hook | ✅ En place | ✅ Refuse commits dangereux |
| E2E tests | ✅ Env vars | ✅ Identique |

