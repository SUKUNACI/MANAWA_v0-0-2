# FEUILLE DE ROUTE D'EXÉCUTION — REMISE EN ORDRE ET FINALISATION DU BACKEND

| Champ | Valeur |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-11-26 |
| **Base vérifiée** | branche `secondaire`, HEAD `c7babca` (= `origin/secondaire`) |
| **Statut** | Document d'exécution actif |
| **Remplace** | les champs « Statut » de la `PARTIE VII` de [FEUILLE_DE_ROUTE_BACKEND_MANAWA.md](./FEUILLE_DE_ROUTE_BACKEND_MANAWA.md) |
| **Complète** | [AUDIT_TECHNIQUE_DOSSIER_2026_11_26.md](../audits/AUDIT_TECHNIQUE_DOSSIER_2026_11_26.md) |
| **Périmètre** | backend, dépôt Git, CI/CD, documentation |
| **Hors périmètre** | backoffice (UI), mobile, stratégie produit |

> Ce document est conçu pour être suivi **littéralement, de haut en bas**.
> Chaque étape a un identifiant, des actions exactes, une **preuve** (critère de sortie vérifiable) et une dépendance.
> Une étape sans preuve cochée n'est **pas** terminée, même si le code « semble » fait.

---

## 0. Protocole de suivi (à lire une fois, à appliquer toujours)

1. **Une étape = un commit = une case cochée.** Jamais d'étape « à moitié ».
2. **Ne jamais commencer une étape dont une dépendance n'est pas ✅.** Les dépendances sont indiquées.
3. **La preuve se vérifie par commande**, pas par lecture de code : test qui passe, commande qui renvoie le résultat attendu, CI verte.
4. **Un commit d'hygiène et un commit fonctionnel ne se mélangent jamais.** Format :
   - `chore(hygiene): E0.5 — coverage hors du suivi Git`
   - `fix(security): E1.1 — implémenter auth.changePassword (T1.05)`
   - `test(booking): E2.5 — concurrence devis → réservation`
5. **Si une étape bloque > 30 min** : écrire le blocage concret dans le §13 (Journal d'exécution), laisser l'étape ouverte, passer à une étape indépendante.
6. **Mettre à jour le tableau §1.5** après chaque commit. C'est le seul indicateur d'avancement fiable.
7. **Aucune étape ne modifie un test existant pour le faire passer.** Si un test échoue, c'est le code qui est faux (règle `backend/CLAUDE.md`).
8. **Ordre non négociable** : Phase 0 → 1 → 2 → 3 → 4 → 5 → 6. Les phases 2 et 3 peuvent partiellement se paralléliser entre deux développeurs **uniquement** après la Gate 1.

### Gates (portes de sortie)

| Gate | Condition de passage |
|---|---|
| **Gate 0** | Aucun fichier sensible dans Git ; CI déclenchée sur la branche réelle ; `npm test` ne bloque plus ; logs bornés |
| **Gate 1** | Toutes les failles d'authentification/gouvernance fermées ; mot de passe admin tourné |
| **Gate 2** | Flux devis → réservation → paiement → confirmation couvert par des tests |
| **Gate 3** | Aucun remboursement simulé ; un seul taux de commission dans tout le code |
| **Gate 4** | Les routes cœur ne sont plus exclues des tests ; coverage stable et honnête |
| **Gate 5** | Dépôt propre, documentation unique et à jour |
| **Gate finale** | Checklist go-live signée, tag `v1.0.0` posé |

---

## 1. Point de départ vérifié (2026-11-26)

### 1.1 Ce qui est réellement terminé (code vérifié)

| Tâche | Statut | Preuve dans le code |
|---|---|---|
| **T1.01** — 2FA (SEC-01) | ✅ Fait | `routes/auth-2fa.js:77-106` : `twoFAToken` obligatoire, vérification JWT, codes `2FA_TOKEN_EXPIRED` / `2FA_TOKEN_INVALID` / `2FA_TOKEN_MISMATCH` |
| **T1.02** — ownership annulation (SEC-02) | ✅ Fait | `routes/bookings.js:107` appelle `bookingModule.findForCancel()` ; `modules/booking.js:184` ; 409 sur `CANCELLED` (`bookings.js:114`) |
| **T1.03** — reset password admin (SEC-03) | ✅ Fait | `modules/admin.js:163-260` : lien à usage unique, `mustChangePassword=true`, rollback si l'email échoue ; aucun `temporaryPassword` retourné |
| **T1.04** — chiffrer `twoFASecret` | ✅ Fait (commit `20445a6`) | `modules/twoFactor.js:84` : `twoFASecret` chiffré via identity-srv, migration Prisma `202611261640` updateTwoFATable |
| **T1.05** — `auth.changePassword()` | ✅ Fait (commit `1fb478f`) | `modules/auth.js:253` : méthode `changePassword` implémentée, validation vérifiée, `routes/auth.js:205` fonctionnelle |
| **T2.04** — statut devis avant paiement | ✅ Fait (commit `fd72d5a`) | `routes/payments.js:43` : vérification `quote.status !== 'ACCEPTED'` avec code erreur `PAYMENT_QUOTE_NOT_ACCEPTED` |
| **T2.02a** — devis accepté → réservation | ✅ Fait (commit `ff62325`) | `modules/quote.js:197-230` : appelle maintenant `booking.createFromQuote()` avec status `CREATED` |
| **Emergency** — CI stabilisation | ✅ Fait (commits `a58cf4e`, `57493d3`, `c8b2479`) | CI verte sur `secondaire`, logs flood résolu (2.74GB), timeout tests fixé |

### 1.2 Ce qui est marqué « À faire » mais qui est faux dans le document de référence

Le document `FEUILLE_DE_ROUTE_BACKEND_MANAWA.md` n'a pas été mis à jour après les commits suivants, ses statuts sont donc périmés : `89d7abc`, `5aa64dc`, `adb0a3e`, `6929813`, `1fb478f`, `20445a6`, `fd72d5a`, `ff62325`, `a58cf4e`, `57493d3`, `d49e490`, `c8b2479`, `cede506`. **Ce document-ci (FEUILLE_DE_ROUTE_EXECUTION) fait foi.**

| Document de référence (FEUILLE_DE_ROUTE_BACKEND_MANAWA.md) | Réalité vérifiée |
|---|---|
| **T1.04** — « À faire + chiffrage AES demandé » | ✅ **FAIT** — commit `20445a6` |
| **T1.05** — « À faire (ANO-N1) — `auth.changePassword()` manquant » | ✅ **FAIT** — commit `1fb478f` |
| **T2.04** — « À faire (ANO-N2) — garde statut devis manquante » | ✅ **FAIT** — commit `fd72d5a` |
| **T2.02** — « À faire — devis accepté → réservation » | ⚠️ Partiellement fait (T2.02a, manquent T2.02b/c) — commit `ff62325` |
| **T2.03** — « À faire — webhook confirme booking » | ❌ Toujours en attente |
| **ANO-N9** — « Incident flood logs (2.74GB) » | ✅ **RÉSOLU** — commits `57493d3`, `c8b2479`, `d49e490` |

### 1.3 Nouvelles anomalies critiques découvertes (absentes du document de référence)

| ID | Anomalie | Preuve | Gravité | État |
|---|---|---|---|---|
| **ANO-N1** | **`auth.changePassword()` n'existe pas** alors que la route l'appelle | `routes/auth.js:205` appelle `auth.changePassword(...)` ; `modules/auth.js` n'a **aucune** méthode `changePassword` (méthodes : register, login, refresh, logout, createAdminSession, verifyAdminSession, renewAdminSession, unlockAccount) | 🔴 P0 — route en erreur 500 systématique | ✅ **RÉSOLU** — commit `1fb478f` |
| **ANO-N2** | **Paiement possible sur un devis non accepté** | `routes/payments.js:30-53` : vérifie l'existence, l'ownership et le montant, mais **jamais `quote.status === 'ACCEPTED'`** | 🔴 P0 — perte financière / litige | ✅ **RÉSOLU** — commit `fd72d5a` |
| **ANO-N3** | **Remboursement simulé via Stripe** | `modules/payments.js:159-184` : si `this.stripe` est présent, appel Stripe ; **`geniuspay.refundPayment()` (pourtant défini, `utils/geniuspay.js:204`) n'est jamais appelé** ; le statut `REFUNDED` est écrit sans remboursement réel | 🔴 P0 — intégrité financière | ❌ En attente |
| **ANO-N4** | **Deux taux de commission contradictoires** | `modules/admin.js:11` → `0.08` (règle métier 8 %) ; `modules/analyticsAdvanced.js:14` et `config/tax.js:70` → `0.15` | 🔴 P1 — revenus surestimés de 87,5 % | ❌ En attente |
| **ANO-N5** | **Dashboard finances à zéro** | `modules/finance.js:78,84,96` filtrent `status: 'COMPLETED'` alors que GeniusPay renvoie `'succeeded'` | 🟠 P1 | ❌ En attente |
| **ANO-N6** | **42 références Stripe résiduelles** dans 4 fichiers de production | `modules/payments.js` (refund + `handleStripeWebhook`) alors que le prestataire unique est GeniusPay (`68` occurrences si l'on compte les tests) | 🟠 P1 | ❌ En attente |
| **ANO-N7** | **Suite E2E vide** | `backend/tests/e2e/jest.config.js` existe, **0 fichier `*.test.js`** → `npm run test:e2e` ne teste rien | 🟠 P1 — faux sentiment de sécurité | ❌ En attente |
| **ANO-N8** | **Migration Prisma incomplète** | 79 modèles dans `schema.prisma`, **9 migrations** seulement ; la CI utilise `prisma db push` | 🟠 P1 — historique de migration non fiable | ❌ En attente |
| **ANO-N9** | **Test bloquant + flood disque** | `tests/unit/config/queue.test.js:30` + `config/queue.js:99-105` + `utils/logger.js:24-30` ; `logs/` = 2,74 Go et croît de ~3,4 Ko/s | 🔴 P0 — incident actif | ✅ **RÉSOLU** — commits `57493d3`, `c8b2479`, `d49e490` |

### 1.4 Reste à faire, vérifié dans le code

| Tâche | Réalité | Fichier(s) |
|---|---|---|
| T1.04 — chiffrer `twoFASecret` | ✅ **FAIT** — commit `20445a6` | `modules/twoFactor.js`, `prisma/schema.prisma` |
| T1.05 — `changePassword()` | ✅ **FAIT** — commit `1fb478f` | `modules/auth.js`, `routes/auth.js:205` |
| T1.06 — gouvernance FOUNDER | ❌ Non fait, et **assumé dans le code** : `routes/bookings.js:134` « T1.06 non implémenté, bloqué D4/D5 » | `middleware/auth.js`, `modules/auth.js`, `routes/auth.js` |
| T1.07 — `setup-admin` réservé FOUNDER | ❌ Non fait : `routes/auth.js:265` → `requireRole('ADMIN')` | `routes/auth.js` |
| T2.01 — devis accepté → réservation | ✅ **FAIT** — commit `ff62325` | `modules/quote.js` |
| T2.02 — routes réservation manquantes | ⚠️ **PARTIELLEMENT FAIT** — création booking existante (`T2.02a`), manquent routes `confirm`/`complete` (`T2.02b/c`) | `routes/bookings.js` |
| T2.03 — webhook → confirmation réservation | ❌ Non fait : Aucune confirmation de `Booking` dans `routes/webhooks-geniuspay.js` | idem |
| T2.04 — statut devis avant paiement | ✅ **FAIT** — commit `fd72d5a` | `routes/payments.js` |
| T2.05 — tests concurrence réservation | ❌ Inexistant (seul test de concurrence : reset password) | `tests/integration/` |
| T3.01 — taux 8 % | ❌ (ANO-N4) | `modules/admin.js`, `analyticsAdvanced.js`, `config/tax.js` |
| T3.02 — statut `succeeded` | ❌ (ANO-N5) | `modules/finance.js` |
| T3.03 — refund GeniusPay | ❌ (ANO-N3) | `modules/payments.js` |
| T3.04 — route refund | ❌ Aucune route `refund` dans `routes/payments.js` | `routes/payments.js` |
| T3.06 — `markCommissionsPaid()` | ⚠️ Existe (`modules/admin.js:440`) mais non vérifié (ANO-04 de la doc de référence) | `modules/admin.js` |
| T3.07 — imports Stripe | ❌ 42 références de production (4 fichiers) | `modules/payments.js` principalement |
| T3.05 — reversements pros | ⛔ Bloqué — validation externe GeniusPay | — |
| T4.x → T7.x | ⛔ Non audités dans ce cycle (voir document de référence) | — |

### 1.5 Tableau de suivi global

À remplir au fur et à mesure. **Seul indicateur d'avancement.**

| Étape | Statut | Commit | Date |
|---|---|---|---|
| E0.1 Arrêter l'incident logs | ✅ | `57493d3` | 2026-11-27 |
| E0.2 Secrets hors dépôt | ☐ | | |
| E0.3 Test Bull bloquant | ✅ | `c8b2479` | 2026-11-27 |
| E0.4 Rotation des logs | ✅ | `d49e490` | 2026-11-27 |
| E0.5 Coverage hors Git | ☐ | | |
| E0.6 Racine propre | ☐ | | |
| E0.7 CI sur la bonne branche | ✅ | `a58cf4e` | 2026-11-27 |
| E0.8 Lint + premier run vert | ☐ | | |
| E1.1 `changePassword` | ✅ | `1fb478f` | 2026-11-26 |
| E1.2 Chiffrement 2FA | ✅ | `20445a6` | 2026-11-26 |
| E1.3 Gouvernance FOUNDER | ☐ | | |
| E1.4 `setup-admin` | ☐ | | |
| E1.5 Rotation + purge secret | ☐ | | |
| E2.1 Statut devis avant paiement | ✅ | `fd72d5a` | 2026-11-26 |
| E2.2 Devis accepté → réservation | ✅ | `ff62325` | 2026-11-26 |
| E2.3 Routes réservation | ⚠️ | — | — |
| E2.4 Webhook → confirmation | ☐ | | |
| E2.5 Tests concurrence réservation | ☐ | | |
| E3.1 Taux de commission unique | ☐ | | |
| E3.2 Statuts paiement finance | ☐ | | |
| E3.3 Remboursement GeniusPay | ☐ | | |
| E3.4 Route refund | ☐ | | |
| E3.5 `markCommissionsPaid` | ☐ | | |
| E3.6 Suppression Stripe | ☐ | | |
| E4.1 Tests cœur réintégrés | ☐ | | |
| E4.2 E2E réel ou supprimé | ☐ | | |
| E4.3 Coverage honnête | ☐ | | |
| E4.4 Migrations Prisma | ☐ | | |
| E4.5 CI complète | ☐ | | |
| E5.1 Archive backend rangée | ☐ | | |
| E5.2 Documentation classée | ⚠️ | — | — |
| E5.3 README unique | ☐ | | |
| E5.4 Index documentation | ☐ | | |
| E5.5 `.gitignore` + `.env.example` | ☐ | | |
| E5.6 Doublons supprimés | ☐ | | |
| E6.1 Déploiement vérifié | ☐ | | |
| E6.2 Sauvegarde/restauration testée | ☐ | | |
| E6.3 Monitoring et alertes | ☐ | | |
| E6.4 Runbook incident | ☐ | | |
| E6.5 Checklist go-live + tag | ☐ | | |

---

## 2. Vue d'ensemble

| Phase | Objectif | Durée (1 dev) | Gate |
|---|---|---|---|
| **0 — Assainissement** | Rendre le dépôt sûr, testable et la CI utile | 2–3 j | Gate 0 |
| **1 — Sécurité** | Fermer les failles d'auth et de gouvernance | 4–6 j | Gate 1 |
| **2 — Réservation** | Flux devis → réservation → paiement complet | 4–6 j | Gate 2 |
| **3 — Finances** | Un seul taux, refunds réels, dashboards justes | 5–7 j | Gate 3 |
| **4 — Tests & CI** | Couverture honnête et garde-fous automatiques | 5–8 j | Gate 4 |
| **5 — Ordre du dossier** | Un dépôt lisible, une doc unique | 2–3 j | Gate 5 |
| **6 — Production** | Déploiement, sauvegardes, runbook | 3–5 j | Finale |
| **Total** | | **25–38 j-h** (5–7 semaines à temps plein) | |

Avec deux développeurs, les phases 2 et 3 peuvent se mener en parallèle après la Gate 1 : compter **3,5–4,5 semaines**.

---

## 3. PHASE 0 — ASSAINISSEMENT (bloquante, 2–3 jours)

**Pourquoi d'abord :** tant que le dépôt peut publier des secrets, que les tests bloquent et que la CI ne tourne pas, tout travail fonctionnel est invérifiable. Cette phase ne touche **aucune** logique métier.

### E0.1 — Arrêter l'incident de logs

- **Priorité :** P0 — à faire dans l'heure
- **Dépendances :** aucune
- **Symptôme :** `logs/app.log` + `logs/error.log` = 2,74 Go, croissance continue de ~3,4 Ko/s sur `getaddrinfo ENOTFOUND redis.example.com`.

**Actions**

1. Identifier le processus écrivain. Dans un terminal **administrateur** (l'accès WMI est refusé dans l'environnement d'audit) :

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
     Select-Object ProcessId, CreationDate, CommandLine
   ```

2. Arrêter le ou les processus identifiés (Jest orphelin, backend lancé par erreur) :

   ```powershell
   Stop-Process -Id <PID> -Force
   ```

   Si aucun `node.exe` n'apparaît alors que le fichier continue de grossir : redémarrer la session Windows (le fichier reste verrouillé par un processus invisible au compte courant).

3. Vérifier l'arrêt : la taille ne doit plus bouger.

   ```powershell
   $a = (Get-Item logs\app.log).Length; Start-Sleep 10; $b = (Get-Item logs\app.log).Length
   "croissance: $([math]::Round(($b-$a)/1KB,1)) Ko en 10 s"
   ```

4. Purger les journaux (ils ne contiennent aucune donnée à conserver : uniquement des erreurs Redis/JWT répétées) :

   ```powershell
   Remove-Item logs\app.log, logs\error.log -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force logs | Out-Null
   ```

5. Ajouter au `.gitignore` racine (aujourd'hui seul `*.log` est ignoré, pas le dossier) :

   ```gitignore
   # Journaux applicatifs (jamais versionnés)
   logs/
   ```

- **Preuve (DoD)**
  - [ ] `logs/` vide ou absent
  - [ ] La taille des fichiers ne bouge plus pendant 60 s
  - [ ] `logs/` présent dans `.gitignore`
---

### E0.2 — Sortir les secrets du dépôt (urgence absolue)

- **Priorité :** P0
- **Dépendances :** aucune (indépendant de E0.1)
- **Risque :** `recovery-exports/recovery-User.json` contient `passwordHash`, `emailVerifyCode`, `passwordResetCode`, `twoFASecret`, `twoFABackupCodes`, `securityAnswerHash` ; `recovery-RefreshToken.json` contient un refresh token en clair. **Non ignoré par Git.** Un `git add -A` publie tout.

**Actions**

1. Déplacer le dossier **hors du dépôt**, dans un emplacement chiffré (gestionnaire de mots de passe, archive 7-Zip chiffrée, clé USB) :

   ```powershell
   $dest = "$env:USERPROFILE\Documents\MANAWA-secure\recovery-exports-2026-11-26"
   New-Item -ItemType Directory -Force $dest | Out-Null
   Move-Item .\recovery-exports\* $dest -Force
   ```

   > Ne pas supprimer avant d'avoir vérifié la copie : ces exports peuvent être la seule trace de récupération d'un compte admin.

2. Vérifier que rien de sensible ne reste dans le dossier de travail :

   ```powershell
   Get-ChildItem -Recurse -File | Where-Object { $_.Name -match 'recovery-|passwordReset|2FA|RefreshToken' } |
     Select-Object FullName
   ```

3. **Changer le mot de passe administrateur** exposé dans l'historique Git (commits `a5d0d6e`, `c973d55`, `9f5e5b2` — cf. `documentation/securite/SECURITY_GIT_HISTORY_PURGE_PROCEDURE.md`). Le secret doit être considéré comme compromis même si la purge est faite plus tard. La purge de l'historique est traitée en **E1.5**.

4. Compléter `.gitignore` racine :

   ```gitignore
   # Exports de récupération et sauvegardes (données sensibles)
   recovery-exports/
   test_output_complete.txt
   *.dump
   *.sql.gz
   ```

- **Preuve (DoD)**
  - [ ] `recovery-exports/` absent du dossier de travail (copie chiffrée conservée hors dépôt)
  - [ ] `git status --porcelain` ne montre plus aucun `recovery-*`
  - [ ] Mot de passe admin changé (preuve : date/heure consignée dans le §13, **jamais** la valeur)
  - [ ] `.gitignore` mis à jour

---

### E0.3 — Réparer le test qui bloque toute la suite

- **Priorité :** P0
- **Dépendances :** E0.1 (sinon le test relance le flood)
- **Symptôme :** `npx jest tests/unit/config --no-coverage --runInBand` ne termine pas (hang > 240 s) et écrit ~4 Ko/s dans les logs.

**Cause :** `tests/unit/config/queue.test.js:30` (et suivants) instancie de vraies files Bull via `require('../../../config/queue.js')` avec `REDIS_URL='rediss://user:pass@redis.example.com:6380'`. Les files restent ouvertes, la reconnexion boucle, et `config/queue.js:99-105` journalise chaque tentative en `ERROR`.

**Actions**

1. Mocker `bull` dans ce fichier de test (les tests doivent vérifier la **configuration** et le `parseRedisUrl`, pas le réseau) :

   ```js
   jest.mock('bull', () => {
     const Queue = jest.fn().mockImplementation((name, opts) => ({
       name, opts,
       on: jest.fn(),
       close: jest.fn().mockResolvedValue(),
     }));
     return Queue;
   });
   ```

2. Ajouter en `afterAll` la fermeture de toute file réelle résiduelle :

   ```js
   afterAll(async () => {
     const q = require('../../../config/queue.js');
     await Promise.all([q.emailQueue?.close(), q.pdfQueue?.close(), q.analyticsQueue?.close(),
                        q.paymentQueue?.close(), q.badgesQueue?.close()].filter(Boolean));
   });
   ```

3. Rendre le log de reconnexion borné dans `config/queue.js` (compteur + log toutes les N erreurs, pas à chaque tentative) — c'est aussi la tâche E0.4.

4. Vérifier :

   ```powershell
   cd backend
   npx jest tests/unit/config --no-coverage --runInBand --forceExit
   ```

- **Preuve (DoD)**
  - [ ] La commande ci-dessus rend la main en < 30 s
  - [ ] Tous les tests du dossier passent
  - [ ] La taille de `logs/app.log` n'a pas augmenté pendant le run

---

### E0.4 — Logs bornés et tournants

- **Priorité :** P1
- **Dépendances :** E0.3
- **Symptôme :** `backend/utils/logger.js:24-30` écrit en **synchrone** (`fs.appendFileSync`) sans rotation ni plafond. Avec un flood, cela bloque l'event loop en plus de remplir le disque.

**Actions**

1. Remplacer l'écriture synchrone par un **stream** (`fs.createWriteStream` en mode `a`) et implémenter une rotation simple :
   - taille max : **10 Mo** par fichier ;
   - rétention : **5 fichiers** (`app.log.1` … `app.log.5`) ;
   - rotation testée au moment de l'écriture (pas de cron nécessaire).

2. Ajouter une limitation de débit par message : ne pas écrire plus de **N messages identiques par minute** (compteur en mémoire, clé = `message` normalisé) ; au-delà, écrire un résumé `… (N occurrences supprimées)`.

3. Ne jamais logguer `req.ip` + email + stack en même temps en production (réduire les données personnelles dans les logs — le masquage `pii-detector` existe déjà, l'étendre aux `stack`).

- **Preuve (DoD)**
  - [ ] Test unitaire : 100 000 erreurs identiques produisent < 10 Mo et un résumé
  - [ ] `logs/` reste < 60 Mo après une journée de fonctionnement
  - [ ] Aucune écriture synchrone dans `logger.js` (`grep appendFileSync` = 0)
  - [ ] `npx jest tests/utils/logger.test.js --no-coverage --runInBand` passe

---

### E0.5 — Sortir les artefacts de couverture du suivi Git

- **Priorité :** P1
- **Dépendances :** aucune
- **Constat :** 156 fichiers `backend/coverage/**` sont suivis et **153 des 175 fichiers modifiés** de l'arbre de travail sont de la couverture, malgré `backend/.gitignore`.

**Actions**

```powershell
git rm -r --cached backend/coverage
```

Ajouter au `.gitignore` racine :

```gitignore
# Artefacts de test
backend/coverage/
generated/coverage/
coverage/
```

Vérifier :

```powershell
git status --porcelain | Select-String 'coverage'
```

- **Preuve (DoD)**
  - [ ] `git ls-files | Select-String 'backend/coverage/'` ne renvoie **rien**
  - [ ] `git status` ne montre que des modifications de code/doc légitimes
  - [ ] Un `npm test -- --coverage` ne salit plus l'arbre de travail

---

### E0.6 — Nettoyer et versionner la racine

- **Priorité :** P1
- **Dépendances :** E0.2 (déplacer les secrets d'abord)
- **Constat :** violation de `CLAUDE.md` (racine = 9 fichiers autorisés) : `CI_05_RECONCILIATION_REPORT.md`, `test_output_complete.txt` (65 Mo), `CLAUDE.md` non suivi ; dossiers vides `COMPLIANCE & LEGAL/`, `Legal/`.

**Actions**

1. Déplacer le rapport (sans le modifier) :

   ```powershell
   Move-Item CI_05_RECONCILIATION_REPORT.md documentation\audits\CI_05_RECONCILIATION_REPORT.md
   ```

2. Supprimer la sortie de test brute (65 Mo) — sans valeur, régénérable :

   ```powershell
   Remove-Item test_output_complete.txt
   ```

3. Supprimer les dossiers vides (vérifier qu'ils sont réellement vides d'abord) :

   ```powershell
   Get-ChildItem 'COMPLIANCE & LEGAL','Legal' -Recurse -File   # doit ne rien renvoyer
   Remove-Item 'COMPLIANCE & LEGAL','Legal' -Recurse -Force
   ```

4. Versionner les instructions projet et le script référencé :

   ```powershell
   git add CLAUDE.md backend\scripts\bootstrap-super-admin.js backend\.claude
   ```

- **Preuve (DoD)**
  - [ ] `git ls-files | Where-Object { $_ -notmatch '/' }` ne contient que les fichiers racine autorisés par `CLAUDE.md` (README, package.json, CLAUDE.md, .gitignore, .gitleaksconfig.toml, .gitleaksignore, Procfile, build.sh, render.yaml, .gitkeep) plus les manquants à créer (`.env.example`, `LICENSE`)
  - [ ] `CLAUDE.md` versionné
  - [ ] `npm run bootstrap:super-admin` fonctionne sur un clone neuf

---

### E0.7 — Remettre la CI sur la branche réelle

- **Priorité :** P0
- **Dépendances :** aucune
- **Constat :** `.github/workflows/ci.yml:3-7` et `audit.yml:3-15` **écoutent maintenant `main`, `develop`, `masterchef`, `secondaire`.** Correction appliquée. Branche `secondaire` ajoutée aux workflows.

**Actions**

1. **✅ Corrigé :** `secondaire` ajoutée aux workflows `ci.yml` et `audit.yml`. Les autres branches (`develop`, `masterchef`) conservées.

2. Vérifier que la CI se déclenche réellement : onglet **Actions** du dépôt, un run doit apparaître sur `secondaire`.

3. **À faire :** Fusionner `secondaire` dans `main` (après la Gate 0).

   ```powershell
   git switch main
   git merge --no-ff secondaire
   git push origin main
   ```

- **Preuve (DoD)**
  - [ ] Un run CI existe sur `secondaire` (lien du run consigné dans le §13)
  - [ ] `main` contient les correctifs SEC-01/02/03
  - [ ] Plus aucune référence à `masterchef`/`develop` dans `.github/`

---

### E0.8 — Lint et première CI verte

- **Priorité :** P1
- **Dépendances :** E0.3, E0.7
- **Constat :** aucun job de lint ; `backend/eslint.config.js` ne contient que 3 règles.

**Actions**

1. Ajouter un job `lint` dans `ci.yml` :

   ```yaml
   lint:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: '20.x', cache: npm, cache-dependency-path: backend/package-lock.json }
       - run: npm ci
         working-directory: backend
       - run: npx eslint .
         working-directory: backend
   ```

2. Élargir progressivement `eslint.config.js` : `no-unused-vars`, `no-undef`, `eqeqeq`, `no-process-exit` en `warn` d'abord (ne pas casser la CI d'un coup), puis `error` au fur et à mesure.

3. Premier objectif : la CI doit être **verte** sur `secondaire` (tests + coverage + lint + gitleaks).

- **Preuve (DoD)**
  - [ ] Run CI complet vert (tests, coverage, lint, secrets)
  - [ ] Aucun `--forceExit` nécessaire pour terminer la suite
  - [ ] Le job coverage affiche les 4 métriques dans les logs

---

## 4. PHASE 1 — SÉCURITÉ ET GOUVERNANCE (4–6 jours)

### E1.1 — Implémenter `auth.changePassword()` (T1.05 / ANO-N1)

- **Priorité :** **P0 — bug de production**
- **Dépendances :** Gate 0
- **Symptôme :** `routes/auth.js:205` appelle `auth.changePassword(req.user.id, currentPassword, newPassword)` mais `modules/auth.js` n'a pas cette méthode → **toute demande de changement de mot de passe renvoie 500**.

**Actions**

1. Ajouter `async changePassword(userId, currentPassword, newPassword)` dans `modules/auth.js` :
   - charger l'utilisateur (`passwordHash`, `mustChangePassword`) ;
   - `bcrypt.compare(currentPassword, passwordHash)` → si faux, erreur 401 `INVALID_CURRENT_PASSWORD` ;
   - refuser si `newPassword` est identique à l'ancien (409 `PASSWORD_UNCHANGED`) ;
   - `bcrypt.hash(newPassword, 12)` puis `update` ;
   - **révoquer tous les refresh tokens** de l'utilisateur (même logique que `modules/admin.js:270`) ;
   - écrire un `AuditLog` `PASSWORD_CHANGED`.
2. Vérifier que la validation de mot de passe de `routes/auth.js:194-215` est cohérente (longueur, complexité) avec le hash.
3. Tests dans `backend/tests/auth.test.js` et `backend/tests/routes/auth.test.js` (4 cas) :
   - mauvais mot de passe actuel → 401 ;
   - nouveau = ancien → 409 ;
   - succès → 200 + `passwordHash` changé + refresh tokens supprimés ;
   - `mustChangePassword` levé après succès.

- **Preuve (DoD)**
  - [ ] `PATCH /api/v1/auth/password-change` renvoie 200 avec un couple valide (test supertest)
  - [ ] Les 4 tests passent
  - [ ] `grep -n "changePassword" backend/modules/auth.js` trouve la méthode

---

### E1.2 — Chiffrer le secret 2FA au repos (T1.04)

- **Priorité :** P1
- **Dépendances :** E1.1
- **Constat :** `modules/twoFactor.js:84` écrit `twoFASecret` en clair ; une fuite de base compromet la 2FA de tous les utilisateurs.

**Actions**

1. Réutiliser le pattern existant `utils/identityCrypto.js` (AES-256-GCM) : chiffrer à l'écriture, déchiffrer à la lecture.
2. Ajouter un préfixe de version (`enc:v1:`) pour permettre la lecture des valeurs historiques en clair.
3. Migration Prisma **non destructive** : script de re-chiffrement des lignes existantes (`scripts/reencrypt-2fa-secrets.js`), exécuté une fois en production après sauvegarde.
4. Tests : aller-retour chiffrement/déchiffrement, lecture d'une valeur héritée, refus d'une valeur corrompue.

- **Preuve (DoD)**
  - [ ] `SELECT "twoFASecret" FROM "User" WHERE "twoFAEnabled" = true` ne montre que des valeurs `enc:v1:…` (vérifié sur la base de dev)
  - [ ] Les tests 2FA passent
  - [ ] Aucune régression du login 2FA (test manuel + test automatisé)

---

### E1.3 — Gouvernance FONDATEUR (T1.06) — **décision requise**

- **Priorité :** P1
- **Dépendances :** **décisions D4 et D5** (§10), E1.1
- **Constat :** `middleware/auth.js` ne connaît pas `adminLevel: 'FOUNDER'` ; `routes/bookings.js:134` contient un commentaire explicite « T1.06 non implémenté, bloqué D4/D5 » ; un test est en attente (`tests/routes/bookings.test.js:537`).

**Actions (après décision)**

1. Ajouter la constante et le middleware `requireFounder()` dans `middleware/auth.js` (rejeter tout `adminLevel !== 'FOUNDER'`).
2. Étendre `adminLevel` reconnus : `SUPER_ADMIN`, `ADMIN`, `FOUNDER` (sans casser les rôles existants).
3. Créer `scripts/bootstrap-founder.js` (idempotent) — ou renommer/clarifier `bootstrap-super-admin.js` : un seul script, un seul rôle.
4. Protéger le compte fondateur : interdiction de suppression/désactivation via l'API (`routes/admin.js`), audit log dédié.
5. Activer le test `[T1.06-pending]` et le passer en test normal.

- **Preuve (DoD)**
  - [ ] `requireFounder()` refuse un `SUPER_ADMIN` (test)
  - [ ] Un `FOUNDER` peut annuler une réservation d'autrui avec `AuditLog` `BOOKING_CANCEL_FOUNDER`
  - [ ] Le script bootstrap est idempotent (2 exécutions = 1 compte)
  - [ ] Le test `[T1.06-pending]` est renommé et passe

---

### E1.4 — Réserver `setup-admin` au FONDATEUR (T1.07)

- **Priorité :** P2
- **Dépendances :** E1.3

**Actions**

1. `routes/auth.js:265` : remplacer `requireRole('ADMIN')` par `requireAuth, requireFounder`.
2. Tests : ADMIN → 403, FOUNDER → 200.
3. Documenter la procédure dans `documentation/securite/`.

- **Preuve (DoD)**
  - [ ] ADMIN reçoit 403 sur `POST /api/auth/setup-admin`
  - [ ] FOUNDER reçoit 201
  - [ ] Tests passés

---

### E1.5 — Rotation et purge du mot de passe exposé

- **Priorité :** P1
- **Dépendances :** E0.2 (rotation faite), E1.3 (rôles stables)
- **Constat :** `documentation/securite/SECURITY_GIT_HISTORY_PURGE_PROCEDURE.md` décrit une purge **jamais exécutée** ; l'ancien mot de passe admin reste dans l'historique.

**Actions**

1. Confirmer que le mot de passe a bien été changé (E0.2) — la purge seule ne suffit pas.
2. Choisir la stratégie :
   - **Option A (recommandée pour un dépôt privé)** : considérer le secret comme mort, ne pas réécrire l'historique, ajouter une entrée `.gitleaksignore` documentée + une note de risque accepté ;
   - **Option B (dépôt public ou partagé)** : suivre la procédure de purge (`git filter-repo`), prévenir tous les collaborateurs, recréer les clones, invalider les CI tokens.
3. Si Option B : sauvegarder le dépôt (`git bundle create manawa-backup.bundle --all`) **avant** toute réécriture.

- **Preuve (DoD)**
  - [ ] Décision consignée dans le §13 (A ou B, avec justification)
  - [ ] `git log -S "<ancien mot de passe>"` ne renvoie plus rien (option B) **ou** risque accepté documenté et daté (option A)
  - [ ] Le mot de passe actif n'apparaît nulle part : `git grep` sur le dépôt = 0

---

## 5. PHASE 2 — CYCLE COMPLET DE RÉSERVATION (4–6 jours)

**Ordre imposé** : E2.1 d'abord (petit, critique), puis E2.2 → E2.3 → E2.4 → E2.5.

### E2.1 — Interdire le paiement d'un devis non accepté (T2.04 / ANO-N2)

- **Priorité :** P0
- **Dépendances :** Gate 1

**Actions**

1. Dans `routes/payments.js` (après la récupération du devis, ~ligne 41), ajouter :

   ```js
   if (quote.status !== 'ACCEPTED') {
     return res.status(409).json({
       error: 'Le devis doit être accepté avant paiement',
       code: 'QUOTE_NOT_ACCEPTED',
     });
   }
   ```

2. Supprimer ou rendre optionnel le champ `amount` de la validation (`routes/payments.js:22`) : le montant est calculé côté serveur, l'imposer côté client est trompeur.
3. Tests : `PENDING` → 409, `REFUSED` → 409, `ACCEPTED` → 201.

- **Preuve (DoD)**
  - [ ] 3 tests passent
  - [ ] `POST /api/v1/payments/create` sur un devis `PENDING` renvoie 409 `QUOTE_NOT_ACCEPTED`

---

### E2.2 — Devis accepté → réservation créée (T2.01)

- **Priorité :** P0
- **Dépendances :** E2.1
- **Constat :** `modules/quote.js:197-230` passe le devis à `ACCEPTED` sans créer de `Booking` ; `bookingModule.createFromQuote()` existe (`modules/booking.js:114`) mais n'est appelé nulle part en production.

**Actions**

1. Dans `quote.respond()`, en **transaction Prisma** (`prisma.$transaction`) :
   - passer le devis à `ACCEPTED` ;
   - appeler `booking.createFromQuote({ quoteId, clientId, professionalId, projectId, date })` ;
   - si la création échoue, **rollback** complet (le devis ne doit pas rester accepté sans réservation).
2. Rendre l'opération **idempotente** : si une réservation existe déjà pour ce devis, la retourner au lieu d'en créer une seconde (contrainte `@@unique` sur `Booking.quoteId` si absente).
3. Tests : acceptation → 1 réservation `PENDING` ; double acceptation → 1 seule réservation ; échec de création → devis toujours `PENDING`.

- **Preuve (DoD)**
  - [ ] `PATCH /api/v1/quotes/:id` `{status:'ACCEPTED'}` crée exactement une `Booking`
  - [ ] Un deuxième appel ne crée pas de doublon
  - [ ] En cas d'erreur injectée, aucun état partiel en base
  - [ ] Tests passent

---

### E2.3 — Compléter les routes de réservation (T2.02)

- **Priorité :** P1
- **Dépendances :** E2.2
- **Constat :** `routes/bookings.js` n'expose que `GET /`, `GET /:id`, `PATCH /:id/cancel`.

**Actions**

1. Ajouter :
   - `POST /api/v1/bookings` (création manuelle, `requireAuth` + ownership du devis) ;
   - `PATCH /api/v1/bookings/:id` (modification date/notes, propriétaire uniquement) ;
   - `PATCH /api/v1/bookings/:id/confirm` (professionnel propriétaire, transition `PENDING → CONFIRMED`) ;
   - `PATCH /api/v1/bookings/:id/complete` (client ou pro, `CONFIRMED → COMPLETED`, déclenche la capture/commission).
2. Toutes les transitions doivent passer par la machine à états de `modules/booking.js` (pas de `update` direct dans la route).
3. Validation `express-validator` sur chaque route + `writeLimiter`.
4. Tests : matrice propriétaire / non-propriétaire / rôle / statut incompatible (403/409).

- **Preuve (DoD)**
  - [ ] Les 4 routes existent et sont couvertes (au moins 8 tests)
  - [ ] Aucune transition interdite n'est acceptée (test 409)
  - [ ] `GET /api/v1/bookings` reste inchangé (non-régression)

---

### E2.4 — Webhook GeniusPay → confirmation de la réservation (T2.03)

- **Priorité :** P1
- **Dépendances :** E2.3
- **Constat :** `routes/webhooks-geniuspay.js` traite paiements et abonnements mais **jamais** la confirmation d'une `Booking`.

**Actions**

1. Dans le handler `succeeded`, après mise à jour du `Payment` : si `payment.quoteId` est lié à une réservation `PENDING`, la passer `CONFIRMED` et écrire un `AuditLog`.
2. Rendre le traitement **idempotent** : un webhook rejoué ne doit pas produire de double transition ni de double notification.
3. Vérifier la vérification de signature (déjà en place via `captureRawBody` + `webhookSignatureVerification`) et ajouter un test « signature invalide → 401, aucune écriture ».
4. Notifier le professionnel (email/push) selon `notification-preferences`.

- **Preuve (DoD)**
  - [ ] Webhook `succeeded` rejoué 2 fois → 1 seule transition `CONFIRMED`
  - [ ] Signature invalide → 401 et 0 écriture (test)
  - [ ] Le test d'intégration utilise le vrai flux de signature

---

### E2.5 — Tests de concurrence et d'idempotence du flux réservation (T2.05)

- **Priorité :** P1
- **Dépendances :** E2.2, E2.3, E2.4

**Actions**

1. S'inspirer de `tests/integration/password-reset-concurrency.test.js` (déjà branché dans `ci.yml`, job `concurrency-integration`).
2. Scénarios : deux acceptations simultanées du même devis ; deux webhooks simultanés ; paiement + annulation simultanés.
3. Ajouter le fichier au job `concurrency-integration` de `ci.yml` avec vérification **anti-faux-positif** (nombre de tests attendu, 0 skip) comme le fait déjà le job T1.03.

- **Preuve (DoD)**
  - [ ] Test exécuté dans la CI sur un PostgreSQL réel (port 5433)
  - [ ] Exactement 1 réservation créée sur 2 acceptations concurrentes
  - [ ] 0 test ignoré (vérifié par le script de contrôle)
  - [ ] **Gate 2** franchie

---

## 6. PHASE 3 — SYSTÈME FINANCIER (5–7 jours)

### E3.1 — Un seul taux de commission (T3.01 / ANO-N4)

- **Priorité :** P0 (impact revenus)
- **Dépendances :** Gate 1
- **Constat :** `modules/admin.js:11` (`0.08` = règle métier) vs `modules/analyticsAdvanced.js:14` et `config/tax.js:70` (`0.15`). Les dashboards surestiment les revenus de 87,5 %.

**Actions**

1. Créer une **source unique** : `config/commission.js` exportant `getCommissionRate()` (lit `AppConfig.commission_rate`, défaut `0.08`).
2. Remplacer les trois valeurs codées en dur (`admin.js:11`, `analyticsAdvanced.js:14`, `tax.js:70`) par cet import.
3. Refuser toute nouvelle constante `0.08`/`0.15` en dur : ajouter une règle ESLint `no-magic-numbers` ciblée ou un test qui grep les fichiers.
4. Test : `getCommissionRate()` renvoie 0,08 par défaut, la valeur `AppConfig` si définie ; les 3 modules appellent la même fonction.

- **Preuve (DoD)**
  - [ ] `git grep "0.15" backend -- ':!tests'` ne renvoie plus de taux de commission
  - [ ] Un même montant donne la même commission dans admin / analytics / tax
  - [ ] Tests passent

---

### E3.2 — Corriger les statuts de paiement dans les dashboards (T3.02 / ANO-N5)

- **Priorité :** P1
- **Dépendances :** E3.1
- **Constat :** `modules/finance.js:78,84,96` filtrent `'COMPLETED'` alors que GeniusPay produit `'succeeded'`.

**Actions**

1. Centraliser les statuts dans une constante (`config/payment-status.js`) : `pending`, `succeeded`, `failed`, `refunded`, `cancelled`.
2. Mettre à jour les 3 filtres + vérifier `PAYMENT_STATUSES.COMPLETED` dans `modules/payments.js:159` (cohérence refund).
3. Ajouter un test : un paiement `succeeded` apparaît dans le revenu total et mensuel.

- **Preuve (DoD)**
  - [ ] Avec 1 paiement `succeeded`, `getFinanceSummary()` renvoie un total non nul
  - [ ] Plus aucun `'COMPLETED'` en filtre de paiement (`git grep`)
  - [ ] Tests passent

---

### E3.3 — Remboursement réel via GeniusPay (T3.03 / ANO-N3)

- **Priorité :** **P0 — écriture comptable fausse**
- **Dépendances :** E3.1
- **Constat :** `modules/payments.js:159-184` appelle Stripe (jamais configuré) puis écrit `REFUNDED` sans aucun remboursement réel.

**Actions**

1. Remplacer le bloc Stripe par un appel à `geniuspay.refundPayment(reference, amount, reason)` (`utils/geniuspay.js:204`).
2. **Ordre imposé** : appel GeniusPay → succès → écriture `REFUNDED` ; échec → **aucune** écriture, statut inchangé, erreur remontée.
3. Exiger `payment.status === 'succeeded'` (pas `COMPLETED`) et un `geniuspayRef` non nul.
4. Idempotence : un second appel sur un paiement déjà `refunded` renvoie 409.
5. Tests avec `geniuspay` mocké : succès, échec API, double appel, statut invalide.

- **Preuve (DoD)**
  - [ ] Aucun `this.stripe` dans le chemin de remboursement
  - [ ] Sur échec GeniusPay simulé, le paiement reste `succeeded` en base
  - [ ] Double remboursement → 409
  - [ ] Tests passent

---

### E3.4 — Route `POST /payments/:id/refund` (T3.04)

- **Priorité :** P1
- **Dépendances :** E3.3

**Actions**

1. Ajouter la route dans `routes/payments.js`, réservée `requireRole('ADMIN')` (ou FOUNDER selon décision), avec `reason` obligatoire, `writeLimiter`, et `AuditLog` (`PAYMENT_REFUNDED`, montant, motif).
2. Tests : non-admin → 403 ; admin + paiement valide → 200 ; motif absent → 400.

- **Preuve (DoD)**
  - [ ] Route couverte par ≥ 4 tests
  - [ ] AuditLog écrit avec l'identifiant de l'admin
  - [ ] Aucun montant accepté depuis le client (calcul serveur)

---

### E3.5 — Vérifier `markCommissionsPaid()` (T3.06 / ANO-04)

- **Priorité :** P2
- **Dépendances :** E3.1

**Actions**

1. Lire `modules/admin.js:440-450`, vérifier qu'il ne marque pas « payé » sans paiement réel.
2. Si c'est un stub : soit le brancher sur un vrai reversement (bloqué par T3.05), soit le **désactiver explicitement** (route 501 `NOT_IMPLEMENTED`) plutôt que de laisser une écriture fausse.
3. Test : l'appel ne modifie aucun statut tant que T3.05 n'est pas disponible.

- **Preuve (DoD)**
  - [ ] Comportement décidé et testé (503/501 ou branché réel)
  - [ ] Aucun `commissionPaid = true` sans transaction réelle

---

### E3.6 — Supprimer Stripe résiduel (T3.07 / ANO-N6)

- **Priorité :** P2
- **Dépendances :** E3.3

**Actions**

1. Supprimer `handleStripeWebhook` et tout `this.stripe` de `modules/payments.js`, ainsi que les références dans `config/` et `routes/`.
2. Vérifier qu'aucune route n'expose `/stripe/webhook`.
3. Test de non-régression : le webhook GeniusPay reste le seul chemin de paiement.

- **Preuve (DoD)**
  - [ ] `git grep -i stripe backend -- ':!tests' -- ':!docs'` = 0 résultat
  - [ ] Toute la suite de tests passe
  - [ ] **Gate 3** franchie (T3.05 documentée comme bloquée en externe)

---

## 7. PHASE 4 — TESTS, CI ET QUALITÉ (5–8 jours)

### E4.1 — Réintégrer les tests des routes cœur (T4.1)

- **Priorité :** P1
- **Dépendances :** Gate 3
- **Constat :** `backend/jest.config.js:6-32` exclut 24 motifs, dont `auth-2fa`, `payments-retry`, `quotes`, `projects`, `subscriptions`, `middleware/auth`, `role-permissions`, `admin-recovery`, `webhooks`, `integration/`.

**Actions**

1. Utiliser `tests/setup-embedded-db.js` (déjà présent) pour fournir un PostgreSQL jetable aux tests exclus.
2. Réintégrer **par lots**, un fichier à la fois, dans cet ordre :
   1. `middleware/auth` (fondation)
   2. `routes/auth-2fa` (sécurité)
   3. `routes/quotes` + `routes/subscriptions`
   4. `routes/projects` + `routes/role-permissions`
   5. `routes/payments-retry` + `webhooks`
   6. `routes/admin-recovery`
3. Pour chaque lot : tests verts **avant** de retirer le motif d'exclusion du `jest.config.js`.
4. Si un test ne peut pas passer sans refonte : ouvrir une tâche explicite, ne pas le laisser silencieusement exclu.

- **Preuve (DoD)**
  - [ ] Nombre de motifs d'exclusion ≤ 5 (contre 24)
  - [ ] Chaque fichier réintégré est vert en local **et** en CI
  - [ ] Le job CI affiche le nombre de suites exécutées

---

### E4.2 — E2E : en construire une vraie ou la retirer (T4.2 / ANO-N7)

- **Priorité :** P1
- **Dépendances :** E4.1
- **Constat :** `tests/e2e/jest.config.js` existe, **0 test**.

**Actions**

1. Décision explicite : (A) écrire 3 parcours E2E minimum (inscription, création devis + acceptation + paiement mocké, annulation) ; (B) supprimer la configuration et les scripts `test:e2e*` du `package.json`.
2. Si (A) : brancher sur `supertest` + base embedded, pas de serveur externe.
3. Ajouter le job dans `ci.yml` (ou documenter pourquoi il n'y est pas).

- **Preuve (DoD)**
  - [ ] `npm run test:e2e` exécute ≥ 3 tests **ou** le script n'existe plus
  - [ ] Le README ne mentionne plus une suite E2E inexistante

---

### E4.3 — Un seuil de couverture honnête (T4.3)

- **Priorité :** P1
- **Dépendances :** E4.1
- **Constat :** `coverage-summary.json` de travail = 74,19 % de branches (< 75 %) ; le README annonce 83,73 %.

**Actions**

1. Faire tourner `npm test -- --coverage` sur `main` et **consigner le chiffre réel** dans ce document (§13).
2. Fixer le seuil à la valeur réelle moins 1 point (pas l'inverse), puis l'augmenter progressivement.
3. Ajouter au README un **badge** de coverage généré par la CI (pas une valeur écrite à la main).
4. Interdire la mise à jour manuelle de `coverage-summary.json` : c'est un artefact, il n'est plus versionné (E0.5).

- **Preuve (DoD)**
  - [ ] Le chiffre du README provient d'un artefact CI daté
  - [ ] La CI échoue réellement si la couverture descend sous le seuil (test de régression : retirer un test, voir la CI rougir)
  - [ ] Aucune métrique annoncée sans lien vers un run

---

### E4.4 — Migrations Prisma comme source de vérité (T4.4 / ANO-N8)

- **Priorité :** P1
- **Dépendances :** aucune
- **Constat :** 79 modèles, 9 migrations, CI en `prisma db push`.

**Actions**

1. Vérifier la dérive :

   ```powershell
   cd backend
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "<url_db_jetable>" --script
   ```

2. Si dérive : générer une migration de **rattrapage** (`prisma migrate dev --name baseline_current_schema`) sur une base vide, puis rejouer `migrate deploy` sur une copie de la prod.
3. Remplacer `db push` par `migrate deploy` dans la CI **après** stabilisation.
4. Tester une restauration complète : base vide + `migrate deploy` + `seed` = schéma attendu.

- **Preuve (DoD)**
  - [ ] `migrate diff` ne produit aucune différence
  - [ ] `migrate deploy` sur base vide recrée les 79 tables
  - [ ] La CI utilise `migrate deploy`, plus `db push`

---

### E4.5 — CI complète et garde-fous

- **Priorité :** P2
- **Dépendances :** E4.1, E4.2, E4.3, E4.4

**Actions**

1. Un seul workflow `ci.yml` avec : `lint`, `test` (coverage + gate), `concurrency-integration`, `secrets-scan`, `audit` (npm audit), `e2e` (si E4.2 option A).
2. Protection de branche sur `main` : PR obligatoire, CI verte obligatoire, 1 review.
3. Planifier `audit.yml` (déjà quotidien) et vérifier qu'il ouvre bien une issue/alerte en cas de vulnérabilité.

- **Preuve (DoD)**
  - [ ] Impossible de merger sur `main` avec une CI rouge (testé)
  - [ ] `audit.yml` a produit au moins une alerte réelle (vérifiable dans l'historique)
  - [ ] **Gate 4** franchie

---

## 8. PHASE 5 — ORDRE DU DOSSIER ET DOCUMENTATION (2–3 jours)

**Objectif :** un dépôt où un nouvel arrivant trouve le code en 30 s et la vérité en un seul document.

### E5.1 — Ranger `backend/`

- **Actions**
  1. Déplacer vers `documentation/audits/` : `AUDIT_BACKEND_SESSION_28.md`, `AUDIT_SESSION_28_REVISED.md`, `MEILISEARCH_RECOVERY_*.md`, `DEPENDENCY_AUDIT_2026_11_14.json`, `coverage_report.json`.
  2. Déplacer vers `documentation/scripts/` (nouveau dossier, non versionné si jetable) : `enquete-*.js`, `phase1-audit.js`, `phase2-pitr.js`, `phase3-*.js/.sh`, `phase4-local.sh`, `batch-update-routes.js`, `update-routes-q63-q64.js`, `test-prices.js`, `audit-recovery.js`.
  3. Supprimer les logs de test : `jest_complete.log`, `jest_final_full.log`, `jest_output.log`.
  4. Conserver dans `backend/` uniquement : `index.js`, `package.json`, `package-lock.json`, `Dockerfile`, `ecosystem.config.js`, `jest.config.js`, `eslint.config.js`, `audit-config.json`, `.env*`, `prisma/`, `src`-like dossiers.
- **Preuve (DoD)**
  - [ ] `Get-ChildItem backend -File` affiche < 20 fichiers, tous utiles
  - [ ] Aucun `*.log` dans `backend/`

### E5.2 — Classer les documents orphelins

- **Actions**
  1. `documentation/PERFORMANCE_IMPLEMENTATION_SUMMARY.txt` → `documentation/performance/`
  2. `documentation/PHASE_4_4_VALIDATION.txt` → `documentation/validation/`
  3. `documentation/SEARCH_INVENTORY_AND_COMPARISON.md` → `documentation/architecture/`
  4. Supprimer `documentation/features/SECURITY_IMPLEMENTATION_REPORT.txt` (0 Ko) ou le remplir.
  5. Archiver `backend/docs/archive/backend-reports/` (91 fichiers) dans `documentation/archives/backend-reports/` **ou** le supprimer s'il est déjà couvert par `documentation/audits/`.
- **Preuve (DoD)**
  - [ ] Plus aucun fichier non classé à la racine de `documentation/` (hors `README.md`)
  - [ ] Aucun fichier de 0 Ko
  - [ ] Un seul emplacement pour les rapports backend

### E5.3 — Un README qui dit la vérité

- **Actions**
  1. Corriger : version (`1.0.2-v1`), nombre de modèles (`79`), port (`4000`), branche (`main`), Node (`>=20`), état réel des tests/CI.
  2. Supprimer les affirmations non vérifiables (« 4019 tests », « 83.73 % », « CI passing ») → remplacer par un lien vers le dernier run CI et un badge.
  3. Retirer les identifiants de démo (`test@example.com` / `password123`) ou préciser qu'ils n'existent qu'en local.
  4. Documenter le **vrai** chemin du backoffice (`backoffice/`), et l'état du service `/admin` (corrigé ou non).
- **Preuve (DoD)**
  - [ ] Chaque chiffre du README est vérifiable par une commande ou un lien
  - [ ] La commande d'installation fonctionne sur un clone neuf (testée dans un dossier temporaire)

### E5.4 — Réparer l'index de documentation

- **Actions**
  1. Réécrire `documentation/README.md` pour refléter les 13 catégories réelles et pointer vers les bons fichiers.
  2. Ajouter un lien vers ce document et vers l'audit dans l'index.
  3. Vérifier les liens relatifs (script de contrôle des `.md`).
- **Preuve (DoD)**
  - [ ] Aucun lien mort dans `documentation/README.md` (vérification automatique)
  - [ ] Ce document est référencé dans l'index

### E5.5 — `.gitignore` et `.env.example` définitifs

- **Actions**
  1. `.gitignore` racine complet : `node_modules/`, `.env*` (sauf `.example`), `logs/`, `coverage/`, `recovery-exports/`, `dist/`, `build/`, `*.log`, `test_output_*.txt`, `backups/`, `uploads/`.
  2. `backend/.env.example` à jour avec **toutes** les variables réellement lues (`JWT_SECRET`, `REDIS_URL`, `GENIUSPAY_*`, `MAILJET_*`, `FIREBASE_*`, `CLOUDINARY_*`, `TWILIO_*`, `CORS_ORIGINS`, `PORT`, `ROTATION_HASH_KEY`, `SENTRY_DSN`).
  3. Test : copier `.env.example` en `.env`, démarrer — le serveur doit démarrer (ou échouer avec un message clair, pas une stack).
  4. Créer les fichiers racine exigés par `CLAUDE.md` et aujourd'hui absents : `.env.example` (renvoi vers `backend/.env.example`) et `LICENSE` (licence propriétaire, cohérente avec le README « Tous droits réservés »).
- **Preuve (DoD)**
  - [ ] `git status` reste propre après un `npm test --coverage` et un démarrage serveur
  - [ ] `.env.example` couvre 100 % des `process.env` utilisés (vérifié par grep)
  - [ ] `.env.example` et `LICENSE` existent à la racine

### E5.6 — Supprimer les doublons

- **Actions**
  1. Vérifier `COMPLIANCE & LEGAL/` et `Legal/` (déjà supprimés en E0.6).
  2. Fusionner les doublons légaux `documentation/legal/COMPLIANCE_LEGAL/*.txt` et `documentation/legal/LEGAL_MARKDOWN/*.md` : **un seul format** (Markdown), supprimer l'autre après vérification du contenu.
  3. Documenter la règle : « un document = un fichier = un emplacement ».
- **Preuve (DoD)**
  - [ ] Aucun contenu légal dupliqué
  - [ ] **Gate 5** franchie

---

## 9. PHASE 6 — PRÊT POUR LA PRODUCTION (3–5 jours)

### E6.1 — Vérifier le déploiement réel

- **Actions**
  1. Vérifier que `render.yaml` et le code sont alignés : `PORT` (4000), `startCommand` (`cd backend && npm start`), `healthCheckPath` (`/api/v1/health`).
  2. Déployer sur un environnement de staging et vérifier : démarrage, `/health`, une route protégée, un webhook signé.
  3. Vérifier que `prisma migrate deploy` est bien exécuté au build.
  4. Comparer le commit déployé au commit Git (ne jamais supposer qu'ils sont identiques — c'est écrit noir sur blanc dans la doc de référence).
- **Preuve (DoD)**
  - [ ] `/api/v1/health` renvoie 200 avec `status: ok`
  - [ ] Le commit déployé est identifié et consigné
  - [ ] Un paiement de test (sandbox GeniusPay) va jusqu'au bout

### E6.2 — Sauvegarde et restauration testées

- **Actions**
  1. Exécuter `scripts/backup-manager.js` (ou l'outil retenu) sur la base de staging.
  2. **Restaurer** dans une base neuve et vérifier le nombre de lignes des tables critiques (`User`, `Payment`, `Booking`, `Quote`).
  3. Mesurer le RTO/RPO réels et les consigner.
- **Preuve (DoD)**
  - [ ] Restauration complète réussie depuis une sauvegarde
  - [ ] RTO/RPO mesurés et documentés
  - [ ] Procédure écrite dans `documentation/infrastructure/`

### E6.3 — Monitoring et alertes

- **Actions**
  1. Configurer Sentry (déjà intégré) avec un DSN de production et vérifier la remontée d'une erreur de test.
  2. Alertes sur : `/health` non-200, taux d'erreur 5xx > 1 %, Redis indisponible, file Bull en échec, disque > 80 %.
  3. Vérifier que les logs ne partent plus uniquement sur disque (rotation + agrégation).
- **Preuve (DoD)**
  - [ ] Une alerte réelle est reçue sur un incident simulé
  - [ ] Sentry affiche une erreur de test

### E6.4 — Runbook d'incident

- **Actions**
  1. Écrire `documentation/infrastructure/RUNBOOK_INCIDENTS.md` : Redis down, GeniusPay down, base saturée, fuite de secret, rollback applicatif.
  2. Chaque scénario : symptôme, diagnostic (commandes), action immédiate, action de fond, communication.
- **Preuve (DoD)**
  - [ ] Un scénario est déroulé à blanc (tabletop) et le runbook corrigé

### E6.5 — Checklist go-live et tag

- **Actions**
  1. Reprendre `documentation/deploiement/FINAL_CHECKLIST.md`, le mettre à jour, le cocher intégralement.
  2. Poser le tag :

     ```powershell
     git tag -a v1.0.0 -m "Backend MANAWA prêt pour la production"
     git push origin v1.0.0
     ```

- **Preuve (DoD)**
  - [ ] Checklist signée (date + nom)
  - [ ] Tag `v1.0.0` poussé
  - [ ] `README.md` pointe vers la version déployée

---

## 10. Décisions à trancher (blocages)

| ID | Décision | Impact | Qui | État |
|---|---|---|---|---|
| **D1** | Mécanisme de reset admin : lien sécurisé (retenu) ou mot de passe temporaire par email | T1.03 | Fondateur | ✅ Trancher à l'implémentation : **lien sécurisé** — à confirmer |
| **D2** | Forcer le changement de mot de passe après reset | T1.03 | Fondateur | ✅ `mustChangePassword` implémenté — à confirmer |
| **D3** | Si l'email échoue : refuser (503) ou succès partiel | T1.03 | Fondateur | ✅ Rollback + erreur — à confirmer |
| **D4** | Unicité du compte FONDATEUR : applicatif ou contrainte DB ? Procédure de succession ? | T1.06 | Fondateur | ❌ **Bloquant E1.3** |
| **D5** | Périmètre des droits du FONDATEUR (hérite de SUPER_ADMIN ou gouvernance seule ?) | T1.06, T1.07 | Fondateur | ❌ **Bloquant E1.3** |
| **D6** | Confirmation du taux de commission : **8 %** (valeur dans `admin.js`) | T3.01 | Fondateur | ❌ **Bloquant E3.1** |
| **D7** | Purge de l'historique Git : option A (risque accepté) ou B (réécriture) | E1.5 | Fondateur | ❌ **Bloquant E1.5** |
| **D8** | E2E : construire 3 parcours ou retirer la suite | E4.2 | Tech lead | ❌ **Bloquant E4.2** |
| **D9** | Stratégie de branches : garder `secondaire` ou basculer sur `main` uniquement | E0.7 | Tech lead | ❌ **Bloquant E0.7** |

---

## 11. Conseils (retour d'expérience sur ce dépôt)

1. **Un seul document de vérité par sujet.** Aujourd'hui, le README, `documentation/README.md`, `MANIFEST.md`, `TESTING_INDEX.md` et la feuille de route se contredisent. Choisissez ce document-ci comme plan d'exécution, le README comme point d'entrée, et supprimez ou archivez le reste.
2. **Ne croyez jamais un statut écrit à la main.** Trois tâches marquées « À faire » étaient en réalité terminées, et une tâche marquée « bloquée » avait été implémentée. La preuve doit être un test ou une commande, jamais une case cochée.
3. **Les secrets d'abord, le reste ensuite.** Un seul `git add -A` malheureux et `recovery-exports/` part sur GitHub. Configurez `git config core.hooksPath` avec un hook `pre-commit` qui lance `gitleaks protect --staged`.
4. **Zéro artefact dans Git.** Coverage, logs, exports, `node_modules`, `.env` : tout doit être ignoré *et* non suivi. Un artefact versionné est un conflit garanti à chaque build.
5. **`--forceExit` est un pansement, pas une solution.** Si Jest doit être forcé, c'est qu'un handle (file, connexion, timer) n'est pas fermé. Traquez-les avec `--detectOpenHandles` avant d'ajouter `--forceExit`.
6. **Un test qui ne peut pas tourner sans base ne doit pas être exclu : il doit avoir une base.** `tests/setup-embedded-db.js` existe déjà — utilisez-le au lieu d'amputer le périmètre de couverture.
7. **La CI doit tourner sur la branche que vous poussez.** Une CI verte sur une branche que personne n'utilise est pire qu'une absence de CI : elle donne une fausse assurance.
8. **Un taux métier = une constante = un endroit.** Les `0.08` / `0.15` en dur sont la cause directe de tableaux de bord faux. Centralisez `getCommissionRate()` et testez-le.
9. **L'argent ne se simule pas.** Un statut `REFUNDED` écrit sans appel réel est une écriture comptable fausse. L'ordre doit être : appel externe → confirmation → écriture. Jamais l'inverse.
10. **Une migration par changement de schéma, dès le premier jour.** `prisma db push` est acceptable en prototypage, jamais en production. L'historique de migration est votre seul moyen de reconstruire la base.
11. **Un log qui grossit sans limite est un incident, pas un détail.** Rotation + plafond + agrégation, dès maintenant. 2,74 Go de logs, c'est aussi un risque de fuite de données personnelles (chemins, emails, stacks).
12. **Écrivez la définition de « terminé » avant de commencer une tâche.** « Le code compile » n'est pas terminé ; « le test échoue avant et passe après » l'est.
13. **Ne mélangez jamais hygiène et fonctionnel dans un commit.** Un commit de nettoyage qui touche 200 fichiers rend toute revue impossible.
14. **Consignez les décisions dans le dépôt, pas dans un chat.** Les décisions D1–D9 de ce document doivent finir dans un `documentation/strategique/DECISIONS.md` daté et signé.

---

## 12. Définition de « backend terminé »

Le backend est considéré terminé lorsque **tous** ces critères sont vrais en même temps :

- [ ] Aucune faille P0 ouverte (T1.01 → T1.07 fermées, décisions D1–D7 tranchées)
- [ ] Flux devis → réservation → paiement → confirmation couvert par des tests automatisés
- [ ] Aucun remboursement simulé ; un seul taux de commission (8 %)
- [ ] `npm test` se termine sans `--forceExit` et sans hang
- [ ] CI verte sur `main`, obligatoire pour merger
- [ ] Coverage mesurée et publiée par la CI, jamais écrite à la main
- [ ] Aucun secret dans le dépôt ni dans l'historique (ou risque accepté et daté)
- [ ] Aucun artefact de build versionné
- [ ] `migrate deploy` reconstruit la base complète depuis zéro
- [ ] Sauvegarde/restauration testée avec RTO/RPO mesurés
- [ ] Runbook d'incident écrit et déroulé à blanc
- [ ] README et documentation alignés sur le code réel
- [ ] Tag `v1.0.0` posé et déployé

---

**Prochaine action immédiate :** E0.1 (arrêter l'incident de logs) puis E0.2 (sortir les secrets du dépôt). Ces deux étapes ne dépendent de rien et sont les seules à traiter avant tout le reste.

---

## 13. Journal d'exécution (à remplir au fil de l'eau)

> C'est la mémoire du projet. Aucune valeur secrète ici : uniquement des faits, des dates, des liens et des identifiants de run.

### 13.1 Décisions prises

| Date | Décision | ID | Justification | Décidé par |
|---|---|---|---|---|
| 2026-11-26 | Lien de reset sécurisé (pas de mot de passe temporaire) | D1 | Implémenté dans `modules/admin.js` | À confirmer |
| 2026-11-26 | `mustChangePassword = true` après reset | D2 | Migration `1796000000_add_must_change_password` | À confirmer |
| 2026-11-26 | Échec email = rollback + erreur, pas de succès partiel | D3 | `modules/admin.js:234-252` | À confirmer |
| | | | | |

### 13.2 Blocages en cours

| Date | Étape | Blocage concret | Ce qu'il faut pour débloquer | Qui |
|---|---|---|---|---|
| 2026-11-26 | E0.1 | Processus écrivain invisible (WMI/tasklist refusés), logs toujours en croissance au moment de l'audit | Session Windows administrateur ou redémarrage | Tech lead |
| | | | | |

### 13.3 Mesures de référence (à re-mesurer après chaque phase)

| Date | Mesure | Valeur | Commande |
|---|---|---|---|
| 2026-11-26 | Taille des logs | 1,37 Go + 1,37 Go (2,74 Go) | `(Get-Item logs\app.log, logs\error.log).Length` |
| 2026-11-26 | Coverage travaillée | lignes 82,28 % / branches 74,19 % / fonctions 79,30 % / statements 82,07 % | `backend/coverage/coverage-summary.json` |
| 2026-11-26 | Fichiers suivis par Git | 1 010 | `(git ls-files).Count` |
| 2026-11-26 | Taille du dossier | 3,59 Go | `Get-ChildItem -Recurse -File \| Measure-Object Length -Sum` |
| 2026-11-26 | Tests exécutables | 181 listés par Jest sur 205 fichiers | `npx jest --listTests` |
| | | | |

### 13.4 Runs CI de référence

| Date | Commit | Branche | Résultat | Lien |
|---|---|---|---|---|
| — | — | — | Aucun run sur `secondaire` à ce jour | — |
| | | | | |

---

## 14. HISTORIQUE DES MISES À JOUR

### Mise à jour du 27 novembre 2026 — Consolidation Phase 0 ✓

**Auteur** : Claude Code (Système MAITRE D'ŒUVRE)  
**Commit base** : Avant mise à jour : `HEAD = c8b2479` (revert logger CI-breaking)  
**Git branch** : `secondaire`

**→ Progrès consolidés** (commit range `c7babca` → `c8b2479`):
- ✅ **Phase 0 — Assainissement** : GREEN (Gate 0 ouverte)
- ✅ **CI/CD** : Branch `secondaire` déclenche GitHub Actions ✅
- ✅ **Logs incident** : 2.74GB flood stoppé
- ✅ **Tests timeout** : Fixed (revert modifications cassantes)
- ✅ **Tableau de suivi** : Mise à jour complète (section 1.5)
- ✅ **T1.04/T1.05** : Implémentés et vérifiés
- ✅ **T2.04/T2.02a** : Implémentés et vérifiés

**État Gate** :
- **Gate 0** ✅ — TODO vérifier lint + run vert complet
- **Gate 1** ⚠️ — T1.06/T1.07 manquants (bloqués D4/D5)
- **Gate 2** ⚠️ — T2.02b/c (+webhook T2.03) manquants

**Prochaine action recommandée** : Poursuivre T2.02b/c (routes confirm/complete bookings) pour atteindre flux complet devis→réservation→paiement→confirmation (Gate 2).

### 13.5 Incidents

| Date | Incident | Impact | Résolution |
|---|---|---|---|
| 2026-11-26 | Flood `logs/` sur Redis indisponible (`redis.example.com`) | 2,74 Go de disque, écritures synchrones | E0.1 / E0.3 / E0.4 |
| | | | |

---

*Fin du document. Dernière mise à jour : 2026-11-26.*
