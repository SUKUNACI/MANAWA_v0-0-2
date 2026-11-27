/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 MANAWA — PHASE 8 SECURITY PRIVILEGE SEPARATION — VERSION 2 (V2)
════════════════════════════════════════════════════════════════════════════════════════════════════

VERSION: 2.0 (RECONSTRUCTION)
DATE: 2026-11-26
STATUS: DESIGN AND STRUCTURE ONLY — NOT EXECUTED ON NEON
ENVIRONMENT: Neon Production (DO NOT EXECUTE — PREPARATION ONLY)
DATABASE OWNER: neondb_owner (may or may not be superuser — architecture handles both cases)

════════════════════════════════════════════════════════════════════════════════════════════════════
 OBJECTIVES
════════════════════════════════════════════════════════════════════════════════════════════════════

This script implements privilege separation for immutable audit logs (M1) in MANAWA:

1. Create role manawa_audit_admin (non-connectable) — owns M1 tables and protection functions
2. Create role manawa_app (connectable) — application runtime with restricted privileges
3. Ensure AuditLog and SecretAccessLog are:
   - SELECT and INSERT only (no UPDATE or DELETE)
   - Protected by PostgreSQL triggers (BEFORE UPDATE/DELETE)
   - Protected by privilege separation (manawa_app has no UPDATE/DELETE)
   - Readable by manawa_app for verification
   - Writable by manawa_app for logging

════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 1: VERIFY PRECONDITIONS
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

DO $$
BEGIN
  IF current_user NOT IN ('neondb_owner', 'postgres') THEN
    RAISE EXCEPTION 'Script must be executed by neondb_owner or superuser, got: %', current_user;
  END IF;
END $$;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 2: CREATE ROLES
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

CREATE ROLE manawa_audit_admin NOLOGIN;
CREATE ROLE manawa_app WITH LOGIN;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 3: SCHEMA PRIVILEGES
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

GRANT USAGE ON SCHEMA public TO manawa_app;
GRANT USAGE ON SCHEMA public TO manawa_audit_admin;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 4: M1 TABLE PRIVILEGES (SELECT + INSERT ONLY)
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

GRANT SELECT, INSERT ON TABLE "AuditLog" TO manawa_app;
GRANT SELECT, INSERT ON TABLE "SecretAccessLog" TO manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 5: PROTECTION FUNCTION PRIVILEGES
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

GRANT EXECUTE ON FUNCTION prevent_auditlog_mutation() TO manawa_app;
GRANT EXECUTE ON FUNCTION prevent_secretaccesslog_mutation() TO manawa_app;

/*
════════════════════════════════════════════════════════════════════════════════════════════════════
 PHASE 6: SEQUENCE PRIVILEGES
════════════════════════════════════════════════════════════════════════════════════════════════════
*/

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO manawa_app;
