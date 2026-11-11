# MANAWA Compliance Checklist

**Version:** 1.0  
**Last Updated:** 2026-11-11  
**Status:** Production Ready  
**Scope:** Backup, Disaster Recovery, Data Protection

---

## 1. GDPR Compliance Checklist (EU General Data Protection Regulation)

### 1.1 Data Collection & Processing

| Requirement | Status | Evidence | Last Verified |
|-------------|--------|----------|----------------|
| Privacy policy published and accessible | ✓ | `/public/privacy.html` | 2026-11-11 |
| Legal basis documented for all processing | ✓ | `/docs/data-processing.md` | 2026-11-10 |
| Data controller details provided to users | ✓ | Privacy policy, footer | 2026-11-11 |
| User consent obtained before processing | ✓ | Sign-up form, email consent | 2026-10-15 |
| Minors (< 16 years old) age verification | ✓ | Age check on registration | 2026-09-20 |

### 1.2 Data Retention (Critical for Backups)

| Data Type | Retention Period | Justification | Deletion Process |
|-----------|-----------------|---------------|-----------------|
| User Profiles | Until deletion request | Account maintenance | Soft delete + hard delete after 90 days |
| Project Data | Until account deletion | Service provision | Purged from backups after 90 days |
| Transaction Records | 7 years | Financial/tax compliance | Archived to cold storage after 7 years |
| Audit Logs | 90 days minimum | Security/compliance | Auto-purged after 90 days |
| Backup Files | 90 days max | Risk mitigation | Old backups deleted automatically |
| Payment Metadata | 90 days | PCI-DSS requirement | GeniusPay handles retention |
| Email Communications | 30 days | Support records | Auto-purged monthly |

**Implementation:**
```sql
-- Automated retention policy
DELETE FROM users WHERE deletedAt IS NOT NULL 
  AND deletedAt < NOW() - INTERVAL '90 days';

DELETE FROM audit_logs WHERE timestamp < NOW() - INTERVAL '90 days';

DELETE FROM email_queue WHERE createdAt < NOW() - INTERVAL '30 days';
```

**Backup Retention:**
```
- S3 Standard (0-30 days): Full retention
- S3 Glacier (31-90 days): Archive with restricted access
- Delete: After 90 days automatically (backup lifecycle policy)
```

### 1.3 Data Subject Rights

| Right | Implementation | Endpoint |
|------|---|---|
| **Right to Access** | Export all personal data in JSON format | `GET /api/users/me/data-export` |
| **Right to Erasure** | Complete account deletion, removal from all backups | `DELETE /api/users/me` |
| **Right to Portability** | Data in machine-readable format (JSON) | `GET /api/users/me/data-export` |
| **Right to Rectification** | Update profile information | `PUT /api/users/me` |
| **Right to Restrict Processing** | Account suspend/pause functionality | `PUT /api/users/me/suspend` |
| **Right to Object** | Opt-out of marketing emails | Settings → Email preferences |

**Data Export Process:**
```bash
# Endpoint
GET /api/users/me/data-export?format=json

# Returns JSON containing:
{
  "user": { ... all profile data ... },
  "projects": [ ... ],
  "quotes": [ ... ],
  "messages": [ ... ],
  "transactions": [ ... ],
  "audit_log": [ ... ]
}

# Delivered: Within 30 days, downloadable or emailed
```

**Right to Erasure Process:**
```bash
# Step 1: User initiates deletion
DELETE /api/users/me
{
  "password": "confirm_password",
  "reason": "optional feedback"
}

# Step 2: 30-day grace period (can cancel)
# User marked as "deleted" in database

# Step 3: After 30 days, hard delete
# - Remove all personal data from production database
# - Add to backup exclusion list
# - Remove from existing backups (via re-encryption)
# - Archive deletion request for 3 years (legal proof)

# Step 4: Next backup after 30 days doesn't include this user
```

**Backup Exclusion List:**
```
File: /config/backup-exclusion-list.json
{
  "users": [
    "user-id-001",  // Deleted 2026-11-05
    "user-id-042"   // Deleted 2026-10-20
  ],
  "projects": [ ... ],
  "lastUpdated": "2026-11-11T02:00:00Z"
}

# Before every backup, this list is checked
# Excluded records are removed from SQL dump before upload
```

### 1.4 Data Processing Agreement (DPA)

| Provider | DPA Status | Standard Clauses | Last Updated |
|----------|------------|-----------------|--------------|
| AWS | ✓ Signed | Standard Contractual Clauses (SCCs) | 2026-06-01 |
| PostgreSQL RDS | ✓ Included in AWS DPA | AWS Standard Terms | 2026-06-01 |
| Cloudinary | ✓ Signed | SCCs | 2026-08-15 |
| GeniusPay | ✓ Signed | SCCs | 2026-07-20 |
| Mailjet | ✓ Signed | SCCs | 2026-05-10 |
| Firebase | ✓ Included in Google DPA | SCCs | 2026-06-01 |

**Storage Location Compliance:**
- ✓ All EU data remains in EU (Ireland, Frankfurt, Belgium)
- ✓ No transfer to US without SCCs
- ✓ Schrems II compliant (adequate safeguards)

### 1.5 Data Breach Notification

**Incident Response Procedure:**
1. Discover breach (automated monitoring + manual report)
2. Assess impact (# users, # records affected, data sensitivity)
3. Notify DPA within **72 hours** (mandatory)
4. Notify affected users without undue delay
5. Document incident (immutable log, 3-year retention)
6. Implement remediation

**Breach Notification Template:**
```
To: [DPA Authority] data-protection@authority.gov.eu
From: MANAWA (Data Controller)
Subject: Data Breach Notification

Breach Details:
- Date Discovered: 2026-11-11
- Type: Unauthorized access to user emails
- # Users Affected: 847
- # Records: 1,247
- Cause: SQL injection vulnerability (now patched)
- Remediation: Password reset required for all affected users

Notification Sent To Users: [Timestamp]
Security Measures Implemented: [Details]

Incident Reference: BR-20261111-001
```

### 1.6 Privacy by Design

| Control | Implementation | Verification |
|---------|---|---|
| Data Minimization | Collect only necessary data | Quarterly privacy audit |
| Purpose Limitation | Use data only for stated purpose | Privacy policy alignment check |
| Storage Limitation | Automatic deletion after retention period | Backup lifecycle policy |
| Integrity & Confidentiality | Encryption in transit & at rest | Security audit |
| Accountability | Audit logs of all access | Immutable log retention |

---

## 2. PCI-DSS Compliance Checklist

### 2.1 Payment Card Data Protection

**Status:** ✓ **NOT APPLICABLE** - All payment processing delegated to GeniusPay

| Requirement | Status | Notes |
|-----------|--------|-------|
| Store payment card data | ✗ NO | GeniusPay handles all cards |
| Tokenization used | ✓ YES | GeniusPay tokens only |
| Encryption of payment data | ✓ YES | GeniusPay end-to-end |
| PCI-DSS Level 1 compliance | ✓ DELEGATION | GeniusPay certified |

### 2.2 Payment Metadata in MANAWA Database

| Data Point | Stored | Reason | Retention |
|-----------|--------|--------|-----------|
| GeniusPay Transaction ID | ✓ YES | Transaction tracking | 7 years |
| Amount | ✓ YES | Financial records | 7 years |
| Currency | ✓ YES | Multi-currency support | 7 years |
| Timestamp | ✓ YES | Audit trail | 7 years |
| Status (success/failed) | ✓ YES | Business logic | 7 years |
| User ID (payer) | ✓ YES | User tracking | 7 years |
| Card last 4 digits | ✗ NO | PCI-DSS violation if stored |
| Card expiry | ✗ NO | PCI-DSS violation if stored |
| CVV | ✗ NO | NEVER store CVV |
| Card holder name | ✗ NO | Only if explicitly required |

**Compliance Control:**
```javascript
// Before storing payment data, validate
function validatePaymentMetadata(data) {
  const prohibited = ['card_number', 'cvv', 'pin', 'expiry', 'cardholder_name'];
  for (const field of prohibited) {
    if (data[field]) {
      throw new Error(`PCI-DSS violation: Cannot store ${field}`);
    }
  }
  return {
    transactionId: data.transactionId,        // ✓ OK
    amount: data.amount,                      // ✓ OK
    status: data.status,                      // ✓ OK
    geniusPay_token: data.geniusPay_token,   // ✓ OK
  };
}
```

### 2.3 Backup Encryption for Payment Metadata

| Control | Status | Implementation |
|---------|--------|---|
| Backup encryption | ✓ YES | AES-256 (AWS KMS) |
| Key management | ✓ YES | AWS KMS with automatic rotation |
| Access control | ✓ YES | IAM policies restrict access |
| Secure deletion | ✓ YES | Payment records deleted after 7 years + secure wipe |

### 2.4 Annual PCI Compliance Audit

- **PCI Qualified Security Assessor (QSA):** [Vendor Name] (Auditor)
- **Last Audit:** 2026-09-15
- **Next Audit:** 2027-09-15
- **Status:** ✓ PASSED (0 findings, SAC issued)
- **Level:** Level 3 (< $1M annual transactions via GeniusPay)

---

## 3. CCPA Compliance Checklist (California Consumer Privacy Act)

### 3.1 Consumer Privacy Rights

| Right | Implementation | Evidence |
|------|---|---|
| **Right to Know** | Data export endpoint | `GET /api/users/me/data-export` |
| **Right to Delete** | Account deletion with data purge | `DELETE /api/users/me` |
| **Right to Opt-Out** | Marketing email opt-out | Email preferences settings |
| **Right to Non-Discrimination** | No service denial for exercising rights | Policy documented |

### 3.2 Data Categories Collected

| Category | Collected | Purpose | 3rd Party Share |
|----------|-----------|---------|---|
| Identifiers (name, email) | ✓ YES | Account management | Mailjet (email only) |
| Commercial info (projects, quotes) | ✓ YES | Service provision | No |
| Biometric (none) | ✗ NO | N/A | N/A |
| Internet activity (login, clicks) | ✓ YES | Analytics/security | Sentry (errors only) |
| Geolocation | ✓ YES (optional) | Location-based search | No |
| Sensitive data (none) | ✗ NO | Explicitly excluded | N/A |

### 3.3 Privacy Policy Requirements

**CCPA Required Disclosures in Privacy Policy:**
- [x] Categories of personal information collected
- [x] Purpose of collection
- [x] Retention periods
- [x] Consumer rights (CCPA Section 1798.100-1798.120)
- [x] Non-discrimination policy
- [x] Data sharing practices
- [x] Categories of 3rd parties receiving data
- [x] Contact information for privacy requests
- [x] Method to submit requests

**Location:** `/public/privacy.html` + `/public/ccpa.html`

### 3.4 Opt-Out Mechanisms

**Marketing Email Opt-Out:**
```
✓ In-app setting: Account → Email preferences
✓ Every email: "Unsubscribe" link in footer
✓ One-click opt-out: `/api/emails/unsubscribe?token=...`
```

**Tracking/Analytics Opt-Out:**
```
✓ In-app setting: Privacy settings → Analytics
✓ Do Not Track header honored
✓ No cookies for non-essential purposes
```

### 3.5 Backup Data Retention for CCPA

Since CCPA applies to California residents:
- Identify CA resident users in backup
- Exclude opted-out users from marketing/analytics backups
- Honor deletion requests in backup exclusion list
- Comply with 45-day response requirement for data requests

---

## 4. Audit Trail & Immutable Logging

### 4.1 Audit Log Requirements

Every critical action must be logged:

| Action | Logged | Retention | Immutable |
|--------|--------|-----------|-----------|
| User login/logout | ✓ YES | 90 days | ✓ S3 Object Lock |
| Password change | ✓ YES | 90 days | ✓ S3 Object Lock |
| Data export request | ✓ YES | 3 years | ✓ S3 Object Lock |
| Deletion request | ✓ YES | 3 years | ✓ S3 Object Lock |
| Backup operation | ✓ YES | 1 year | ✓ S3 Object Lock |
| Restore operation | ✓ YES | 3 years | ✓ S3 Object Lock |
| Admin action (config change) | ✓ YES | 1 year | ✓ S3 Object Lock |
| Access to sensitive data | ✓ YES | 90 days | ✓ S3 Object Lock |

**Audit Log Schema:**
```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  userId VARCHAR(255),                 -- User performing action
  action VARCHAR(100) NOT NULL,        -- "LOGIN", "DELETE", "EXPORT", etc.
  resourceType VARCHAR(50),            -- "USER", "PROJECT", "DATABASE", etc.
  resourceId VARCHAR(255),             -- ID of affected resource
  changes JSONB,                       -- What changed (old → new)
  ipAddress INET,
  userAgent TEXT,
  status VARCHAR(20),                  -- "SUCCESS", "FAILED", "UNAUTHORIZED"
  errorMessage TEXT,
  createdAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_userId_timestamp 
  ON audit_logs(userId, timestamp);
CREATE INDEX idx_audit_logs_action_timestamp 
  ON audit_logs(action, timestamp);
```

### 4.2 Immutable Audit Log Storage

**S3 Object Lock Configuration:**
```
Bucket: manawa-audit-logs
├── Object Lock: ENABLED (Governance Mode)
├── Default Retention: 90 days
├── Versions: Retained for life of audit log
└── Access: Read-only after 90 days, deleted after retention expires

Files cannot be deleted or modified before 90-day retention expires,
even by AWS administrators or root account.
```

**Audit Log Export:**
```bash
# Daily export to S3 (immutable)
SELECT * FROM audit_logs 
WHERE date(timestamp) = CURRENT_DATE
ORDER BY timestamp;

# Saved as: s3://manawa-audit-logs/2026-11-11.json.gz
# Cannot be deleted for 90 days (S3 Object Lock)
```

### 4.3 Backup of Audit Logs

Audit logs themselves are backed up:
- **Frequency:** Hourly (included in incremental backups)
- **Retention:** 90 days in S3 + cold storage
- **Immutability:** Protected by S3 Object Lock
- **Verification:** Checksum validation after backup

---

## 5. Data Anonymization for Testing & Staging

### 5.1 Anonymization Rules

When promoting production backup to staging/dev:

| Data Field | Original | Anonymized | Reason |
|-----------|----------|-----------|--------|
| email | user@example.com | user-staged-001@test.local | GDPR - PII |
| phone | +33612345678 | +33600000001 | GDPR - PII |
| firstName | John | User | GDPR - PII |
| lastName | Doe | 001 | GDPR - PII |
| password | [hashed] | [random new hash] | Security |
| avatarUrl | https://cdn.../photo.jpg | https://test/placeholder.png | PII |
| city | Paris | Test City | GDPR - location |
| latitude | 48.8566 | 0.0 | GDPR - location |
| longitude | 2.3522 | 0.0 | GDPR - location |
| projectTitle | "Renovation my apartment" | "Test Project 001" | Specific info |
| messages | Real content | "Test message" | GDPR - PII |
| quoteContent | Real estimate | "Test quote content" | Specific info |

**Implementation:**
```sql
-- Anonymize staging database after restore
CALL anonymize_database();

-- Procedure definition
CREATE PROCEDURE anonymize_database()
LANGUAGE plpgsql
AS $$
BEGIN
  -- Users table
  UPDATE users SET 
    email = CONCAT('user-', id, '@test.local'),
    firstName = 'User',
    lastName = SUBSTRING(id, 1, 8),
    phone = '+33600000000',
    avatarUrl = 'https://test.local/placeholder.png',
    city = 'Test City',
    latitude = 0.0,
    longitude = 0.0,
    passwordHash = crypt(gen_random_bytes(32)::text, gen_salt('bf'));
  
  -- Projects table
  UPDATE projects SET 
    title = CONCAT('Test Project ', ROW_NUMBER() OVER ()),
    description = 'Test description',
    location = 'Test City';
  
  -- Messages table
  UPDATE messages SET 
    content = 'Test message content';
  
  -- Quotes table
  UPDATE quotes SET 
    content = 'Test quote content';
END;
$$;
```

### 5.2 Anonymization Verification

After anonymization, verify:
```bash
# No real emails
SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@test.local%';
# Expected: 0

# No real phone numbers (starts with +33)
SELECT COUNT(*) FROM users WHERE phone LIKE '+336%';
# Expected: 0

# No real names (all "User" + ID)
SELECT COUNT(*) FROM users WHERE firstName != 'User';
# Expected: 0

# No real locations
SELECT COUNT(*) FROM users WHERE latitude != 0;
# Expected: 0
```

### 5.3 Restricted Access to Production-Like Data

Even in staging with anonymized data:
- ✓ Restrict access to team members only
- ✓ No production data in code repositories
- ✓ Log all access to staging databases
- ✓ Automatic data refresh weekly (no stale PII risk)
- ✓ Destroy staging data after 30 days unused

---

## 6. Data Security Controls

### 6.1 Encryption Standards

| Data State | Standard | Key Management | Verification |
|-----------|----------|---|---|
| **In Transit** | TLS 1.3 | AWS ACM (auto-renewing certs) | SSL Labs A+ |
| **At Rest (S3)** | AES-256 | AWS KMS (customer-managed key) | Annual audit |
| **At Rest (RDS)** | AES-256 | AWS KMS (customer-managed key) | Annual audit |
| **Backup Files** | AES-256 | AWS KMS + GCS CSEK | Quarterly test |
| **Secrets Manager** | AES-256 | AWS KMS | Annual rotation |

### 6.2 Access Control

**Backup Access Restrictions:**
```
IAM Policy for Backup Users:
├── s3:GetObject (backups only, no DeleteObject)
├── s3:ListBucket (listing backups only)
├── rds:RestoreDBInstanceFromDBSnapshot (staging only)
├── kms:Decrypt (backup decryption only)
└── Deny: s3:DeleteObject, rds:DeleteDBInstance
```

**Audit Trail of Access:**
```
All backup access logged:
- Who accessed it (user ID)
- What they accessed (backup ID)
- When (timestamp)
- From where (IP address)
- What action (download, restore, verify)

Immutably stored in S3 with Object Lock
```

### 6.3 Secure Deletion

After retention expires:
```bash
# Backup files in S3 Standard (30 days)
# → Auto-archive to Glacier after 30 days
# → Auto-delete after 90 days (lifecycle policy)

# Backup files in Glacier (60-90 days)
# → Auto-delete after 90 days (lifecycle policy)

# Cannot be recovered after deletion
# (AES-256 keys destroyed, no recovery possible)
```

---

## 7. Compliance Audit Schedule

### 7.1 Internal Audits (Monthly)

**First Tuesday of Every Month:**
```
□ Backup completion: All scheduled backups completed?
□ Backup verification: All checksums valid?
□ Restore tests: Last weekly test passed?
□ Data retention: No data older than retention limits?
□ Access logs: Any unauthorized access attempts?
□ Incident response: Any unresolved security issues?
□ DR drill status: Quarterly drill scheduled?

Report: /logs/compliance/monthly-audit-{date}.md
```

### 7.2 Quarterly Compliance Review

**Every Q (Jan 15, Apr 15, Jul 15, Oct 15):**
```
□ GDPR compliance verification
□ PCI-DSS payment data check
□ CCPA privacy policy update
□ Audit trail immutability verification
□ Data anonymization process review
□ Encryption key rotation status
□ DR testing results
□ Incident log review

Report: /logs/compliance/quarterly-review-{date}.md
Attendees: CTO, DevOps Lead, DBA, Legal
```

### 7.3 Annual External Audit

**Each November (during slower period):**
```
□ PCI-DSS external audit
□ GDPR compliance assessment
□ Data protection impact assessment (DPIA)
□ Security penetration test
□ Backup recovery test (independent verification)
□ Documentation review
□ Incident response drill

Report: /logs/compliance/annual-audit-{year}.md
Vendor: [QSA Firm Name]
Cost: ~€5,000 - €8,000
```

---

## 8. Compliance Checklist Template

### For Each Backup:

```
Backup ID: full-2026-11-11-020000
Date: 2026-11-11

□ GDPR:
  □ No personal data outside EU (S3 Ireland, GCS Belgium)
  □ Backup exclusion list applied (deleted users removed)
  □ Data retention limits respected (max 90 days)
  □ Encryption enabled (AES-256)

□ PCI-DSS:
  □ No card data included
  □ Payment metadata encrypted
  □ GeniusPay tokens only (no card numbers)

□ CCPA:
  □ CA resident users not excluded improperly
  □ Opt-outs honored in backup

□ Audit Trail:
  □ Backup operation logged
  □ Access log complete
  □ Immutable copy created (S3 Object Lock)

□ Security:
  □ Checksum validated ✓
  □ Encrypted in transit ✓
  □ Encrypted at rest ✓
  □ Replicated to secondary region ✓
  □ Restore test passed ✓

Status: ✅ COMPLIANT
Verified By: [Admin Name]
Timestamp: 2026-11-11T03:15:00Z
```

---

## 9. Contact & Escalation

**Compliance Officer:** [Name] (email@example.com)  
**Data Protection Officer (DPO):** [Name] (dpo@example.com)  
**Legal Team:** legal@manawa.com  
**Security Lead:** security@manawa.com  

**Report Compliance Issues:**
- Email: compliance@manawa.com
- Slack: #compliance (internal only)
- Form: https://manawa.com/compliance/report

---

## 10. References

- GDPR: https://gdpr-info.eu/
- PCI-DSS: https://www.pcisecuritystandards.org/
- CCPA: https://oag.ca.gov/privacy/ccpa
- AWS Compliance: https://aws.amazon.com/compliance/
- Cloudinary Compliance: https://cloudinary.com/trust/

---

**Version:** 1.0  
**Status:** Approved  
**Last Updated:** 2026-11-11  
**Next Review:** 2027-02-11

