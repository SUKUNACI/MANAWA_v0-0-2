# Database Migration Instructions

## Brute Force Protection Setup

After pulling the new brute force protection changes, you need to:

### 1. Generate Prisma Migration

```bash
# Generate migration for the LoginAttempt table
cd backend
npx prisma migrate dev --name add_login_attempt_table
```

This will:
- Create a new migration file in `prisma/migrations/`
- Apply the migration to your database
- Generate updated Prisma client

### 2. Verify Migration

```bash
# Check the migration was successful
npx prisma db push

# Verify table exists
npx prisma studio  # Open Prisma Studio UI
```

### 3. If You Already Have a Database

If you're migrating an existing database:

```bash
# Create migration from current state
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script > migration.sql

# Or use shadow database
npx prisma migrate dev --name add_login_attempt_table --create-only
```

### 4. Production Deployment

For production, use:

```bash
# Apply pending migrations
npx prisma migrate deploy
```

## What Gets Created

The migration adds:

```sql
CREATE TABLE "LoginAttempt" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" TEXT,
  "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "LoginAttempt_userId_idx" ON "LoginAttempt"("userId");
CREATE INDEX "LoginAttempt_email_idx" ON "LoginAttempt"("email");
CREATE INDEX "LoginAttempt_timestamp_idx" ON "LoginAttempt"("timestamp");
```

## Troubleshooting

### Migration Fails Due to Existing Table

If the table already exists:

```bash
# Mark as applied without running
npx prisma migrate resolve --applied "add_login_attempt_table"

# Or manually check status
npx prisma migrate status
```

### Redis Configuration Issues

Brute force protection requires Redis for distributed tracking. If Redis is not available:

- Set `REDIS_URL` environment variable
- System will fallback to in-memory cache automatically
- Fallback is NOT distributed across servers

Environment variable:
```bash
REDIS_URL=redis://localhost:6379
```

### Testing Without Database

For unit tests, the LoginAttempt table is optional:
- Tests may log warnings about table not existing
- This is normal and doesn't affect protection
- The middleware still works via Redis/in-memory cache

## Verification Checklist

After migration:

- [ ] Migration executed successfully
- [ ] `LoginAttempt` table exists in database
- [ ] Indexes are created
- [ ] Can insert test records: `INSERT INTO "LoginAttempt" (...) VALUES (...)`
- [ ] Brute force unit tests pass: `npm test -- tests/brute-force.test.js`
- [ ] Login endpoint works with failed attempts
- [ ] After 5 failures, account is locked (429 status)
- [ ] Successful login clears failed attempts
- [ ] Admin can unlock accounts via `POST /api/auth/unlock`

## Rollback

If you need to rollback:

```bash
# Undo last migration
npx prisma migrate resolve --rolled-back "add_login_attempt_table"

# Or reset entire database (⚠️ DESTRUCTIVE)
npx prisma migrate reset
```

## Next Steps

1. Run migration: `npx prisma migrate dev --name add_login_attempt_table`
2. Test login with failed attempts
3. Verify 429 response after max attempts
4. Configure Redis URL for production
5. Deploy to production with `npx prisma migrate deploy`
