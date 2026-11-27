/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 MANAWA — M1 PRIVILEGE SEPARATION — 8 PHASES COMPLÈTES
════════════════════════════════════════════════════════════════════════════════════════════════════

VERSION: FINAL
DATE: 2026-11-26
STATUS: ✅ SECRETACCESSLOG EN INSERT-ONLY (DELETE REVOQUÉ)
ENVIRONMENT: Neon Production (DO NOT EXECUTE — PREPARATION ONLY)
DATABASE OWNER: Superuser (postgres)

════════════════════════════════════════════════════════════════════════════════════════════════════
 CORRECTIONS APPLIQUÉES (SESSION 39-40)
════════════════════════════════════════════════════════════════════════════════════════════════════

✅ CORRECTION 1: SecretAccessLog en INSERT-ONLY
   Before: GRANT SELECT, INSERT, DELETE ON TABLE "SecretAccessLog" TO manawa_app;
   After:  GRANT SELECT, INSERT ON TABLE "SecretAccessLog" TO manawa_app;
   Raison: M1 trigger prevent_secretaccesslog_mutation() bloque tous DELETE
   Code: cleanOldLogs() supprimée de SecretAccessTracker.js (lignes 162-183)

✅ CORRECTION 2: AuditLog en INSERT-ONLY
   Before: GRANT SELECT, INSERT, DELETE ON TABLE "AuditLog" TO manawa_app;
   After:  GRANT SELECT, INSERT ON TABLE "AuditLog" TO manawa_app;
   Raison: M1 trigger prevent_auditlog_mutation() bloque tous DELETE
   Code: archiveOldLogs() désactivée dans AuditLogModule.js (lignes 250-256)

✅ CORRECTION 3: Tests nettoyés
   Suppression: 4 tests obsolètes de cleanOldLogs() (SecretAccessTracker.test.js lignes 437-484)
   Suppression: Mock inutilisé deleteMany (ligne 17)
   Résultat: 205/205 tests PASS (100%)

════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 1: CRÉER LES DEUX RÔLES
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

-- manawa_audit_admin: Owner of M1 tables and triggers (non-connectable)
CREATE ROLE manawa_audit_admin NOLOGIN;

-- manawa_app: Application role with restricted privileges
-- IMPORTANT: Créé avec LOGIN mais SANS mot de passe.
-- L'authentification doit être configurée dans Neon (password policy, PAM, etc.)
-- et l'application doit être provisionnée avec les credentials appropriés.
CREATE ROLE manawa_app WITH LOGIN;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 1b: ADHÉSION À MANAWA_AUDIT_ADMIN (CORRECTION CRITIQUE)
════════════════════════════════════════════════════════════════════════════════════════════════════

Rendre neondb_owner membre de manawa_audit_admin.

Raison technique (PostgreSQL 16):
Lors de ALTER TABLE ... OWNER TO new_role, l'utilisateur actuel doit être MEMBRE du rôle cible.
CREATEROLE permet de créer le rôle, mais n'accorde pas automatiquement l'adhésion requise pour
effectuer des transferts de propriété.

Options SET et INHERIT:
- SET TRUE: Autorise explicitement neondb_owner à changer de rôle vers manawa_audit_admin.
  Cela satisfait la condition PostgreSQL pour les ALTER ... OWNER TO.
- INHERIT FALSE: Empêche neondb_owner d'hériter automatiquement des privilèges de
  manawa_audit_admin. neondb_owner ne reçoit que l'adhésion, pas les privilèges du rôle.

Cette instruction satisfait la condition PostgreSQL imposée par:
- ALTER TABLE "AuditLog" OWNER TO manawa_audit_admin (PHASE 2)
- ALTER TABLE "SecretAccessLog" OWNER TO manawa_audit_admin (PHASE 2)
- ALTER FUNCTION prevent_auditlog_mutation() OWNER TO manawa_audit_admin (PHASE 3)
- ALTER FUNCTION prevent_secretaccesslog_mutation() OWNER TO manawa_audit_admin (PHASE 3)
- ALTER TABLE "NewAuditLog" OWNER TO manawa_audit_admin (PHASE 8b)

Sans cette adhésion, tous les transferts de propriété échouent avec:
  ERROR: must be member of role "manawa_audit_admin"

Documentation: PostgreSQL 16 — ALTER TABLE ... OWNER TO, GRANT (membership options)
*/

GRANT manawa_audit_admin TO neondb_owner WITH SET TRUE, INHERIT FALSE;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 1c: PRIVILÈGE CREATE SUR LE SCHÉMA PUBLIC (TEMPORAIRE)
════════════════════════════════════════════════════════════════════════════════════════════════════

Accorder temporairement le privilège CREATE sur le schéma public à manawa_audit_admin.

Raison technique (PostgreSQL 16):
PostgreSQL impose que le propriétaire d'un objet dispose du privilège CREATE sur le schéma
contenant cet objet. Pendant les transferts de propriété (PHASE 2-3), manawa_audit_admin
doit disposer de ce privilège.

Après les transferts, le privilège sera révoqué (voir PHASE 3b ci-dessous).
Cela respecte le principe de privilèges minimaux: manawa_audit_admin propriétaire
des objets M1, sans privilège créateur supplémentaire sur le schéma.

Documentation: PostgreSQL 16 — GRANT (Privilege Levels on Database Objects)
*/

GRANT CREATE ON SCHEMA public TO manawa_audit_admin;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 2: TRANSFÉRER PROPRIÉTÉ DES TABLES M1
════════════════════════════════════════════════════════════════════════════════════════════════════

Transfert de ownership de neondb_owner → manawa_audit_admin

IMPORTANT: Sur Neon, Prisma exécute les migrations via neondb_owner
(DATABASE_URL et DIRECT_URL utilisent ce rôle).
Les tables M1 sont créées avec owner=neondb_owner, puis transférées à manawa_audit_admin.

Prérequis vérifiés en PHASE 1b:
- neondb_owner est membre de manawa_audit_admin ✓
- manawa_audit_admin dispose du privilège CREATE sur public ✓
*/

ALTER TABLE "AuditLog" OWNER TO manawa_audit_admin;
ALTER TABLE "SecretAccessLog" OWNER TO manawa_audit_admin;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 3: TRANSFÉRER PROPRIÉTÉ DES FONCTIONS M1
════════════════════════════════════════════════════════════════════════════════════════════════════

Transfert de propriété des fonctions de protection M1 vers manawa_audit_admin.

Raison: Les triggers PostgreSQL BEFORE DELETE/UPDATE qui protègent l'immutabilité
des journaux M1 doivent être propriétés du rôle responsable de la protection,
c'est-à-dire manawa_audit_admin.

Dépendances satisfaites (PHASE 1b):
- neondb_owner est membre de manawa_audit_admin ✓
- manawa_audit_admin dispose du privilège CREATE sur public ✓

Les fonctions resteront exécutées sur chaque INSERT/DELETE/UPDATE de leurs tables déclencheurs.
Cela ne modifie pas leur fonctionnement, uniquement leur propriétaire.

Fonctions transférées:
- prevent_auditlog_mutation() : Bloque DELETE et UPDATE sur AuditLog
- prevent_secretaccesslog_mutation() : Bloque DELETE et UPDATE sur SecretAccessLog
*/

ALTER FUNCTION prevent_auditlog_mutation() OWNER TO manawa_audit_admin;
ALTER FUNCTION prevent_secretaccesslog_mutation() OWNER TO manawa_audit_admin;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 3b: RÉVOQUER CREATE SUR LE SCHÉMA PUBLIC (PRIVILÈGES MINIMAUX)
════════════════════════════════════════════════════════════════════════════════════════════════════

Révoquer le privilège CREATE temporairement accordé en PHASE 1c.

Raison: manawa_audit_admin est maintenant propriétaire des tables et fonctions M1.
Le propriétaire d'un objet conserve implicitement le droit de modifier sa structure,
même sans le privilège CREATE sur le schéma. La révocation de CREATE suit le principe
de privilèges minimaux: manawa_audit_admin doit posséder ses objets, pas créer de nouveaux.

Effet: manawa_audit_admin ne peut plus créer de nouvelles tables/fonctions/objets dans public.
Cela protège contre la création accidentelle d'objets non-M1 par ce rôle administratif.

Documentation: PostgreSQL 16 — REVOKE (Privilege Levels on Database Objects)
*/

REVOKE CREATE ON SCHEMA public FROM manawa_audit_admin;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 4: ACCORDER PRIVILÈGES SUR MÉTIER (SCHÉMA PUBLIC)
════════════════════════════════════════════════════════════════════════════════════════════════════

Permissions générales pour toutes les tables "métier" (non-M1):
- SELECT, INSERT, UPDATE, DELETE sur toutes les tables existantes
- USAGE sur le schéma public (CREATE intentionnellement NE PAS accordé)

Raison: Toutes les tables sont créées par migrations Prisma (exécutées par neondb_owner).
Application ne doit jamais créer d'objets directement dans le schéma public.

ATTENTION: Cette PHASE accorde temporairement DELETE et UPDATE à manawa_app sur:
  - AuditLog
  - SecretAccessLog

Ces tables M1 recevront DELETE et UPDATE via ALL TABLES (lignes 95-96).
Ces privilèges seront RÉVOQUÉS en PHASE 7 et remplacés par SELECT+INSERT uniquement en PHASE 8.

Risque architectural:
  Entre PHASE 4 et PHASE 7, manawa_app dispose de DELETE/UPDATE sur les tables M1.

Mitigation:
  Les triggers PostgreSQL BEFORE DELETE/UPDATE bloqueront l'exécution même si le privilège est accordé.
  Cela crée une défense en profondeur: privilèges restreints + triggers.
*/

GRANT USAGE ON SCHEMA public TO manawa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 5: ACCORDER PRIVILÈGES SUR SÉQUENCES
════════════════════════════════════════════════════════════════════════════════════════════════════

Permissions sur les séquences (auto-increment):
- USAGE: Pouvoir lire la séquence
- SELECT: Pouvoir obtenir nextval()
*/

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 6: METTRE EN PLACE DEFAULT PRIVILEGES
════════════════════════════════════════════════════════════════════════════════════════════════════

Permissions par défaut pour toutes les NOUVELLES TABLES (futures migrations Prisma).

Rôle réel de migration sur Neon:
- Prisma exécute les migrations via neondb_owner (DATABASE_URL, DIRECT_URL)
- Les tables sont créées avec owner=neondb_owner
- DEFAULT PRIVILEGES FOR USER neondb_owner définit les héritages automatiques

Stratégie de protection M1 futures:

1. PHASE 6 (cette étape): Accorder SELECT, INSERT, UPDATE, DELETE par défaut
   → Futures tables métier (non-M1) reçoivent l'accès complet nécessaire

2. Futures tables M1 créées par migrations recevront automatiquement:
   → SELECT, INSERT, UPDATE, DELETE via DEFAULT PRIVILEGES
   → Triggers BEFORE DELETE/UPDATE (définis dans la migration M1)

3. PHASE 8b (manuelle): Après chaque nouvelle migration M1, exécuter:
   → REVOKE ALL PRIVILEGES ON TABLE new_m1_table FROM manawa_app
   → GRANT SELECT, INSERT ON TABLE new_m1_table TO manawa_app
   → Transfère la propriété à manawa_audit_admin (obligatoire)

4. Résultat après PHASE 8b: Futures tables M1 sont SELECT et INSERT uniquement
   → Privilèges: SELECT et INSERT uniquement
   → Triggers: Bloquent DELETE/UPDATE même si privilèges étaient accordés
   → Propriétaire: manawa_audit_admin (obligatoire via PHASE 8b)

Limitation connue — FENÊTRE DE RISQUE:
  Entre la création d'une future table M1 et l'exécution manuelle de PHASE 8b,
  manawa_app dispose des privilèges DELETE et UPDATE sur cette table (via DEFAULT PRIVILEGES).

  Cette fenêtre de risque est RÉELLE et non-négligeable:
  - Si l'application est déployée AVANT l'exécution de PHASE 8b, elle PEUT tenter DELETE/UPDATE
  - Les triggers PostgreSQL BEFORE DELETE/UPDATE bloqueront physiquement l'exécution
  - Cependant, les tentatives seront loggées comme erreurs applicatives

  Mitigation: Les triggers fournissent PROTECTION DÉFENSIVE (tentatives échouent),
             mais n'éliminent pas le risque métier (erreurs applicatives).

Risque critique si triggers M1 manquent:
  Si les triggers BEFORE DELETE/UPDATE ne sont pas créés (oubli dans la migration),
  la table M1 sera momentanément NON-PROTÉGÉE en UPDATE/DELETE.
  Solution obligatoire: PHASE 8b DOIT être exécutée IMMÉDIATEMENT après chaque migration M1,
  AVANT tout déploiement applicatif utilisant cette nouvelle table M1.

Recommandation: Automatiser l'exécution de PHASE 8b dans le processus de migration
(ex: hook post-migration) ou documenter clairement l'étape manuelle requise.
*/

-- Default privileges for new tables created by neondb_owner
-- (Prisma uses neondb_owner via DATABASE_URL/DIRECT_URL)
-- IMPORTANT: Inclut UPDATE et DELETE pour les tables métier
-- Les tables M1 auront ces privilèges temporairement jusqu'à PHASE 8b
ALTER DEFAULT PRIVILEGES FOR USER neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO manawa_app;

-- Default privileges for sequences created by neondb_owner
-- Suffisant pour auto-increment sur tables métier
ALTER DEFAULT PRIVILEGES FOR USER neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 7: RÉVOQUER TOUS PRIVILÈGES M1
════════════════════════════════════════════════════════════════════════════════════════════════════

Nettoyer tous les privilèges précédents sur les tables M1:
Préparation pour l'octroi spécifique en PHASE 8
*/

REVOKE ALL PRIVILEGES ON TABLE "AuditLog" FROM manawa_app;
REVOKE ALL PRIVILEGES ON TABLE "SecretAccessLog" FROM manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 8: ACCORDER SELECT+INSERT UNIQUEMENT SUR M1 (CORRIGÉE — DELETE REVOQUÉ)
════════════════════════════════════════════════════════════════════════════════════════════════════

PERMISSIONS FINALES:

AuditLog:
  ✅ SELECT — Vérifier la chaîne de hashes
  ✅ INSERT — Créer une nouvelle entrée d'audit
  ❌ DELETE — INTENTIONNELLEMENT REVOQUÉ (immutable)
  ❌ UPDATE — INTENTIONNELLEMENT REVOQUÉ (immutable)

SecretAccessLog:
  ✅ SELECT — Consulter les logs d'accès secret
  ✅ INSERT — Logger un nouvel accès
  ❌ DELETE — INTENTIONNELLEMENT REVOQUÉ (immutable)
  ❌ UPDATE — INTENTIONNELLEMENT REVOQUÉ (immutable)

Raison de cette séparation:
  1. Triggers PostgreSQL prevent_auditlog_mutation() et prevent_secretaccesslog_mutation()
     bloquent TOUS les DELETE et UPDATE au niveau de la base de données
  2. Code backend SecretAccessTracker.cleanOldLogs() a été supprimée
  3. Code backend AuditLogModule.archiveOldLogs() a été désactivée
  4. Logs secrets/audit sont conservés INDÉFINIMENT pour traçabilité complète
*/

GRANT SELECT, INSERT ON TABLE "AuditLog" TO manawa_app;
GRANT SELECT, INSERT ON TABLE "SecretAccessLog" TO manawa_app;

-- DELETE intentionnellement NE PAS accordé — immutabilité M1 garantie par:
--   (a) PostgreSQL trigger BEFORE DELETE (migration.sql lignes 99-102)
--   (b) Code backend: aucune tentative de suppression (cleanOldLogs supprimée)
--   (c) Privilèges: manawa_app ne peut physiquement pas DELETE

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 8b: TEMPLATE POUR FUTURES TABLES M1
════════════════════════════════════════════════════════════════════════════════════════════════════

PROCÉDURE À APPLIQUER IMMÉDIATEMENT APRÈS CHAQUE NOUVELLE MIGRATION M1:

Cette phase ne contient pas d'instructions SQL exécutées automatiquement.
Elle fournit des modèles (templates) destinés aux migrations M1 futures.
L'administrateur doit exécuter manuellement ces modèles pour chaque nouvelle table M1.

CONDITIONS PRÉALABLES À VÉRIFIER:
   ✓ La migration M1 a créé la table avec owner=neondb_owner
   ✓ Les triggers BEFORE DELETE/UPDATE sont présents et correctement créés
   ✓ PHASE 1b exécutée: neondb_owner est membre de manawa_audit_admin
   ✓ PHASE 1c exécutée: manawa_audit_admin avait CREATE sur schema public (révoqué en 3b)

TEMPLATE SQL À EXÉCUTER (remplacer "NewAuditLog" par le nom réel):

   -- Étape 1: Vérifier l'existence de la table
   SELECT tablename FROM pg_tables WHERE tablename = 'NewAuditLog' AND schemaname = 'public';

   -- Étape 2: Vérifier les triggers M1 (doivent être BEFORE DELETE/UPDATE et actifs)
   -- PostgreSQL 16: information_schema.triggers + pg_trigger.tgenabled
   SELECT
     t.trigger_name,
     t.event_manipulation,
     CASE WHEN t.action_timing IS NOT NULL THEN t.action_timing ELSE 'BEFORE' END as action_timing,
     pg_t.tgenabled as trigger_enabled,
     pg_p.proname as function_name
   FROM information_schema.triggers t
   LEFT JOIN pg_trigger pg_t ON pg_t.tgname = t.trigger_name
   LEFT JOIN pg_proc pg_p ON pg_p.oid = pg_t.tgfoid
   WHERE t.event_object_table = 'NewAuditLog' AND t.trigger_name LIKE '%mutation%'
   ORDER BY t.event_manipulation;
   -- Expected output (2 rows):
   -- Row 1: trigger_name=prevent_*_mutation, event_manipulation=DELETE, action_timing=BEFORE, trigger_enabled='O', function_name=prevent_*_mutation
   -- Row 2: trigger_name=prevent_*_mutation, event_manipulation=UPDATE, action_timing=BEFORE, trigger_enabled='O', function_name=prevent_*_mutation
   -- Note: tgenabled='O' means enabled, 'D' means disabled, 'R' and 'A' mean replica modes

   -- Étape 3: Révoquer les privilèges hérités (DEFAULT PRIVILEGES)
   REVOKE ALL PRIVILEGES ON TABLE "NewAuditLog" FROM manawa_app;

   -- Étape 4: Accorder SELECT et INSERT uniquement
   GRANT SELECT, INSERT ON TABLE "NewAuditLog" TO manawa_app;

   -- Étape 5: Accorder temporairement CREATE pour le transfert
   GRANT CREATE ON SCHEMA public TO manawa_audit_admin;

   -- Étape 6: Transférer la propriété à manawa_audit_admin
   ALTER TABLE "NewAuditLog" OWNER TO manawa_audit_admin;

   -- Étape 7: Révoquer CREATE après le transfert (privilèges minimaux)
   REVOKE CREATE ON SCHEMA public FROM manawa_audit_admin;

   -- Étape 8: Vérifier le résultat final
   SELECT tablename, tableowner FROM pg_tables WHERE tablename = 'NewAuditLog';
   -- Expected: owner = manawa_audit_admin

   -- Étape 9: Vérifier les privilèges finaux
   \dp "NewAuditLog"
   -- Expected: manawa_app: SELECT,INSERT / manawa_audit_admin: (all privileges)

EXPLICATION DES ÉTAPES:

1. REVOKE ALL PRIVILEGES: Annule l'héritage de DEFAULT PRIVILEGES (UPDATE, DELETE, etc.)
   → Rend la table vierge de privilèges pour manawa_app

2. GRANT SELECT, INSERT: Accorde les droits sûrs uniquement
   → manawa_app peut lire et créer des entrées, mais pas modifier/supprimer

3. GRANT CREATE (temporaire): Satisfait la condition PostgreSQL pour transfert de propriété
   → Nécessaire pour ALTER TABLE ... OWNER TO

4. ALTER TABLE ... OWNER: Transfère propriété à manawa_audit_admin
   → Prérequis: neondb_owner doit être membre (confirmé en PHASE 1b)
   → Prérequis: manawa_audit_admin doit avoir CREATE temporairement (étape 3)

5. REVOKE CREATE: Applique privilèges minimaux
   → manawa_audit_admin propriétaire mais sans privilège créateur supplémentaire

Chronologie de sécurité pour une nouvelle table M1:

   [Migration crée "NewAuditLog" avec owner=neondb_owner]
                    ↓
   [Table hérite SELECT, INSERT, UPDATE, DELETE via PHASE 6]
                    ↓
   [Triggers BEFORE DELETE/UPDATE créés par la migration M1]
                    ↓
   ⚠️  FENÊTRE DE VULNÉRABILITÉ: manawa_app a UPDATE/DELETE (héritées)
       → Les triggers bloquent l'exécution (défense en profondeur)
       → Mais le privilège est temporairement accordé
                    ↓
   [Administrateur exécute PHASE 8b pour cette table]
                    ↓
   [REVOKE ALL supprime UPDATE/DELETE]
   [GRANT SELECT, INSERT restaure les droits sûrs]
                    ↓
   ✅ État final: manawa_app peut SELECT et INSERT uniquement
                    ✅ Triggers bloquent DELETE/UPDATE même en cas d'erreur

Risques et mitigations:

Risque 1: Oubli de PHASE 8b après création d'une nouvelle table M1
   → manawa_app dispose de UPDATE/DELETE sur la nouvelle table
   → Mitigation: Triggers PostgreSQL bloquent l'exécution
   → Mitigation: Documentation clairement visible et automatisation possible

Risque 2: Exécution de PHASE 8b avant la création des triggers M1
   → Table M1 reçoit SELECT+INSERT sans trigger de protection
   → Mitigation: Vérifier que la migration M1 inclut les triggers
   → Mitigation: ALTER TABLE ... OWNER ne peut échouer que si manawa_audit_admin manque

Risque 3: Confusion entre tables métier et tables M1
   → Tables métier ont DELETE/UPDATE permanents (OK)
   → Tables M1 doivent avoir SELECT et INSERT uniquement (via PHASE 8b)
   → Mitigation: Noms explicites (suffix "_AuditLog", "_AccessLog")
   → Mitigation: Commentaires dans les migrations M1

Prérequis pour PHASE 8b:
   ✓ PHASE 1b exécutée: neondb_owner est membre de manawa_audit_admin (SET TRUE, INHERIT FALSE)
   ✓ PHASE 1-3b exécutée entièrement (transferts complets, CREATE temporaire révoqué)
   ✓ Table M1 créée avec owner=neondb_owner
   ✓ Triggers M1 créés (BEFORE DELETE/UPDATE) et actifs

Note: Le transfert de propriété en PHASE 8b accorde temporairement CREATE à manawa_audit_admin,
      ce qui satisfait la condition PostgreSQL pour ALTER TABLE ... OWNER TO.
      CREATE est révoqué immédiatement après le transfert.

Recommandations:

1. Automatiser l'exécution de PHASE 8b dans le processus de déploiement
2. Ou: Fournir un script d'automatisation que l'administrateur lance après chaque migration M1
3. Ou: Documenter clairement l'étape manuelle et l'inclure dans une checklist de déploiement

La version manuelle actuelle est sûre si bien documentée et exécutée rapidement après création.
*/

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 RÉSUMÉ FINAL — MATRICE DE PRIVILÈGES APRÈS 8 PHASES
════════════════════════════════════════════════════════════════════════════════════════════════════

Rôle: manawa_app

TABLES MÉTIER (PHASE 4):
  SELECT     ✅  (métier complet)
  INSERT     ✅  (métier complet)
  UPDATE     ✅  (métier complet)
  DELETE     ✅  (métier complet)

TABLES M1 — AuditLog (PHASE 8):
  SELECT     ✅  (vérifier chaîne + requêtes)
  INSERT     ✅  (créer entrée)
  UPDATE     ❌  (REVOQUÉ — trigger + privilèges)
  DELETE     ❌  (REVOQUÉ — trigger + privilèges)

TABLES M1 — SecretAccessLog (PHASE 8):
  SELECT     ✅  (vérifier logs d'accès)
  INSERT     ✅  (logger accès)
  UPDATE     ❌  (REVOQUÉ — trigger + privilèges)
  DELETE     ❌  (REVOQUÉ — trigger + privilèges)

RÉSULTAT:
  ✅ Logs secrets/audit immutables (3 niveaux: triggers PostgreSQL + privilèges DB + code)
  ✅ Application peut lire + insérer mais ne peut pas supprimer
  ✅ Traçabilité complète d'accès secrets (aucune suppression automatique)
  ✅ Conformité immutabilité M1

════════════════════════════════════════════════════════════════════════════════════════════════════
 PRÉREQUIS ET CONDITIONS D'EXÉCUTION
════════════════════════════════════════════════════════════════════════════════════════════════════

CONDITIONS CONFIRMÉES (pré-exécution — audit réalisé):
  ✅ neondb_owner possède CREATEROLE
  ✅ neondb_owner est NON-SUPERUSER
  ✅ Connexion utilise neondb_owner (DATABASE_URL, DIRECT_URL)
  ✅ AuditLog et SecretAccessLog existent et appartiennent à neondb_owner
  ✅ prevent_auditlog_mutation() et prevent_secretaccesslog_mutation() existent
  ✅ Triggers BEFORE DELETE/UPDATE créés sur les deux tables M1
  ✅ manawa_audit_admin et manawa_app n'existent pas encore
  ✅ Aucun privilège par défaut préexistant pour neondb_owner

CONDITIONS REQUISES LORS DE L'EXÉCUTION (vérifier avant):
  ✓ Utilisateur exécutant: neondb_owner
  ✓ Base de données: Neon Production (redact_manawa)
  ✓ Schéma: public
  ✓ Pas de transactions parallèles sur les objets M1
  ✓ Connexion stable (pas de timeout réseau)

VÉRIFICATIONS PRÉALABLES À L'EXÉCUTION:

Avant de lancer ce script, exécuter les vérifications suivantes:

   -- 1. Vérifier que neondb_owner est l'utilisateur actuel
   SELECT current_user;
   -- Expected: neondb_owner

   -- 2. Vérifier l'existence des tables M1
   SELECT tablename FROM pg_tables
   WHERE tablename IN ('AuditLog', 'SecretAccessLog') AND schemaname = 'public';
   -- Expected: Both tables present

   -- 3. Vérifier la propriété actuelle des tables M1
   SELECT tablename, tableowner FROM pg_tables
   WHERE tablename IN ('AuditLog', 'SecretAccessLog');
   -- Expected: Both owned by neondb_owner

   -- 4. Vérifier l'existence des fonctions M1
   SELECT proname FROM pg_proc
   WHERE proname IN ('prevent_auditlog_mutation', 'prevent_secretaccesslog_mutation');
   -- Expected: Both functions present

   -- 5. Vérifier que manawa_audit_admin n'existe pas encore
   SELECT rolname FROM pg_roles WHERE rolname = 'manawa_audit_admin';
   -- Expected: (empty)

   -- 6. Vérifier que manawa_app n'existe pas encore
   SELECT rolname FROM pg_roles WHERE rolname = 'manawa_app';
   -- Expected: (empty)

   -- 7. Vérifier les options d'adhésion de neondb_owner (après PHASE 1b)
   -- À exécuter APRÈS PHASE 1b mais AVANT PHASE 2:
   SELECT m.rolname, g.rolname, am.set_option, am.inherit_option
   FROM pg_auth_members am
   JOIN pg_roles g ON g.oid = am.roleid
   JOIN pg_roles m ON m.oid = am.member
   WHERE m.rolname = 'neondb_owner' AND g.rolname = 'manawa_audit_admin';
   -- Expected: set_option = true, inherit_option = false (confirmé par SET TRUE, INHERIT FALSE)

   -- 8. Vérifier les privilèges du schéma public (après PHASE 1c)
   -- À exécuter APRÈS PHASE 1c:
   SELECT
     'manawa_audit_admin' as role_to_check,
     has_schema_privilege('manawa_audit_admin', 'public', 'CREATE') as has_create_privilege,
     has_schema_privilege('manawa_audit_admin', 'public', 'USAGE') as has_usage_privilege;
   -- Expected: has_create_privilege = true, has_usage_privilege = true (after PHASE 1c)

   -- Post-PHASE 3b (after REVOKE), verify CREATE is revoked:
   -- SELECT has_schema_privilege('manawa_audit_admin', 'public', 'CREATE') as has_create;
   -- Expected: has_create = false

Si l'une de ces vérifications échoue, ne pas lancer le script. Corriger l'état de la base.

ORDRE D'EXÉCUTION OBLIGATOIRE:
  1. PHASE 1 — CREATE ROLE
  2. PHASE 1b — GRANT adhésion (CRITIQUE pour transferts)
  3. PHASE 1c — GRANT CREATE sur schema
  4. PHASE 2 — ALTER TABLE OWNER
  5. PHASE 3 — ALTER FUNCTION OWNER
  6. PHASE 3b — REVOKE CREATE (privilèges minimaux)
  7. PHASE 4 — GRANT SELECT, INSERT, UPDATE, DELETE
  8. PHASE 5 — GRANT USAGE, SELECT séquences
  9. PHASE 6 — ALTER DEFAULT PRIVILEGES
 10. PHASE 7 — REVOKE ALL M1
 11. PHASE 8 — GRANT SELECT, INSERT M1
 12. PHASE 8b — TEMPLATE (exécuter manuellement pour chaque nouvelle table M1)

INSTRUCTIONS D'EXÉCUTION (NE PAS EXÉCUTER — PRÉPARATION UNIQUEMENT)

This file is for REVIEW AND DOCUMENTATION ONLY.
DO NOT execute these commands on Neon Production without explicit user authorization.

If execution is authorized:
1. Se connecter à Neon Production avec neondb_owner:
   psql postgresql://neondb_owner:PASSWORD@ep-*.neon.tech:5432/redact_manawa

2. RECOMMANDATION: Exécuter DANS UNE TRANSACTION UNIQUE pour garantir l'atomicité:

   BEGIN;
   -- Lancer ce script complet (PHASE 1 à PHASE 8):
   \i path/to/PHASE_8_PRIVILEGE_SEPARATION_SECRETACCESSLOG_INSERT_ONLY.sql
   COMMIT;

   Raison: Éviter un état intermédiaire entre PHASE 4 et PHASE 7 où manawa_app
   aurait DELETE/UPDATE sur M1 tables avant la révocation finale.
   Si l'application se connecte au milieu de ce script, elle ne devrait pas utiliser
   les tables M1.

   Variante (si débogage interactif nécessaire):
   Exécuter les phases individuellement avec vérifications entre chacune.
   ATTENTION: Pendant cette exécution non-atomique, il y a des états intermédiaires dangereux.

3. Vérifier après PHASE 8:

   -- Vérifier les privilèges M1
   \dp "AuditLog"
   \dp "SecretAccessLog"

   Expected: manawa_app: SELECT,INSERT / manawa_audit_admin: (all)

   -- Vérifier l'ownership
   SELECT tablename, tableowner FROM pg_tables
   WHERE tablename IN ('AuditLog', 'SecretAccessLog');

   Expected: Both owned by manawa_audit_admin

   -- Vérifier les triggers
   SELECT trigger_name, event_manipulation FROM information_schema.triggers
   WHERE event_object_table IN ('AuditLog', 'SecretAccessLog');

   Expected: BEFORE DELETE, BEFORE UPDATE triggers present

   -- Tester les privilèges (en tant que manawa_app)
   SET ROLE manawa_app;
   SELECT COUNT(*) FROM "AuditLog";  -- Should succeed
   INSERT INTO "AuditLog" (...) VALUES (...);  -- Should succeed
   UPDATE "AuditLog" SET ... WHERE ...;  -- Should FAIL
   DELETE FROM "AuditLog" WHERE ...;  -- Should FAIL
   RESET ROLE;

4. Redéployer l'application (Render) si modifications tierces requises

5. Tests complets (suite Jest 4512 tests):
   npm run test
   Expected: 0 failures, 100% suites passing

════════════════════════════════════════════════════════════════════════════════════════════════════
 RÉCUPÉRATION EN CAS D'ÉCHEC
════════════════════════════════════════════════════════════════════════════════════════════════════

Le script ne peut pas être rejoué aveuglément (il n'est pas idempotent).
En cas d'échec, diagnostiquer l'état réel avant de reprendre.

DIAGNOSTIC DE L'ÉTAT:

Vérifier les rôles créés:
   SELECT rolname FROM pg_roles WHERE rolname IN ('manawa_audit_admin', 'manawa_app') ORDER BY rolname;

Vérifier les propriétaires actuels des tables M1:
   SELECT tablename, tableowner FROM pg_tables
   WHERE tablename IN ('AuditLog', 'SecretAccessLog');

Vérifier l'adhésion de neondb_owner:
   SELECT g.rolname, m.rolname FROM pg_auth_members am
   JOIN pg_roles g ON g.oid = am.roleid
   JOIN pg_roles m ON m.oid = am.member
   WHERE m.rolname = 'neondb_owner' AND g.rolname = 'manawa_audit_admin';

Vérifier les privilèges sur le schéma public:
   SELECT grantee, privilege_type FROM information_schema.role_usage_grants
   WHERE object_schema = 'public' AND object_name = 'public' AND grantee IN ('manawa_app', 'manawa_audit_admin');

REPRISE APRÈS ÉCHEC:

Identifier la dernière phase exécutée avec succès en utilisant les vérifications ci-dessus.

Si PHASE 1 a échoué (rôles non créés):
   → Vérifier les droits de neondb_owner (doit avoir CREATEROLE)
   → Réessayer PHASE 1-3b

Si PHASE 1b a échoué (adhésion non établie):
   → Vérifier que manawa_audit_admin a été créé (PHASE 1)
   → Réessayer PHASE 1b (relancer GRANT, elle est idempotente)
   → Continuer depuis PHASE 2

Si PHASE 2 a échoué (transfert de propriété des tables):
   → Vérifier que neondb_owner est membre de manawa_audit_admin (PHASE 1b)
   → Vérifier que les tables appartiennent actuellement à neondb_owner
   → Réessayer PHASE 2 (relancer ALTER TABLE, elle corrige l'état)

Si PHASE 3 a échoué (transfert de propriété des fonctions):
   → Mêmes vérifications que PHASE 2
   → Réessayer PHASE 3
   → Continuer depuis PHASE 3b (REVOKE CREATE)

Si PHASE 3b a échoué (revocation de CREATE):
   → Vérifier que manawa_audit_admin existe
   → Réessayer PHASE 3b (REVOKE est idempotent)
   → Continuer depuis PHASE 4

Si PHASE 4 ou suivantes ont échoué:
   → Les phases sont largement indépendantes après PHASE 3
   → Identifier la phase échouée via l'erreur
   → Vérifier les prérequis (tables, rôles, propriété)
   → Réessayer la phase échouée

EN CAS D'ARRÊT COMPLET:

Si impossible de reprendre proprement, options:

1. Analyser les dépendances avant toute suppression:
   -- Vérifier si des tables ou objets dépendent des rôles:
   SELECT * FROM pg_shdepend WHERE refobjid IN
     (SELECT oid FROM pg_roles WHERE rolname IN ('manawa_app', 'manawa_audit_admin'));
   -- Si des dépendances existent, les corriger avant suppression de rôles

2. Continuer partiellement (recommandé):
   - Identifier l'état via les diagnostics ci-dessus
   - Appliquer manuellement les phases manquantes en vérifiant chacune
   - Reverifier après chaque phase complétée

3. En dernier recours (après analyse des dépendances):
   Si suppression des rôles est décidée:
   DROP ROLE IF EXISTS manawa_app;
   DROP ROLE IF EXISTS manawa_audit_admin;
   -- Puis relancer les PHASES 1-3b entièrement
   -- ATTENTION: Cette opération ne doit être effectuée qu'après vérification des dépendances

4. Contacter l'administrateur Neon pour aide sur l'état de la base

════════════════════════════════════════════════════════════════════════════════════════════════════
 RÉTROCOMPATIBILITÉ
════════════════════════════════════════════════════════════════════════════════════════════════════

Entrées AuditLog et SecretAccessLog existantes:
  ✅ LISIBLES (GRANT SELECT)
  ✅ PRÉSERVÉES (AUCUN DELETE)
  ✅ VÉRIFIABLES (triggers toujours actifs)

Pas de migration de données requise. Simplement appliquer les 8 PHASES.

════════════════════════════════════════════════════════════════════════════════════════════════════
 RÉFÉRENCES
════════════════════════════════════════════════════════════════════════════════════════════════════

Code backend modifié:
  - modules/SecretAccessTracker.js: cleanOldLogs() supprimée (lignes 162-183)
  - modules/AuditLogModule.js: archiveOldLogs() désactivée (throw Exception)

Tests corrigés:
  - tests/modules/SecretAccessTracker.test.js: 4 tests cleanOldLogs supprimés (lignes 437-484)
  - Mock inutilisé deleteMany supprimé (ligne 17)
  - Résultat: 205/205 tests PASS (100%)

Migration M1:
  - prisma/migrations/1794753067_add_immutable_audit_logs/migration.sql
  - Triggers: prevent_auditlog_mutation() (lignes 67-82)
  - Triggers: prevent_secretaccesslog_mutation() (lignes 87-102)

════════════════════════════════════════════════════════════════════════════════════════════════════
*/
