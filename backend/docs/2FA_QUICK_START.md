# 2FA Quick Start Guide

## What is 2FA?

Two-Factor Authentication (2FA) adds a second layer of security to user accounts. After entering their password, users must provide a code from an authenticator app (Google Authenticator, Authy, etc.) or use a backup code.

## For Frontend Developers

### 1. Setup Flow

Show 2FA setup screen after user requests it:

```javascript
// Step 1: Request setup
const setupResponse = await fetch('/api/v1/auth/2fa/setup', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const { setupToken, qrCode, backupCodes } = await setupResponse.json();

// Step 2: Display QR code and backup codes to user
// Show QR code as image: <img src={qrCode} />
// Show backup codes as list for user to save

// Step 3: Get TOTP code from user's authenticator app
const totpCode = prompt('Enter the 6-digit code from your authenticator app');

// Step 4: Enable 2FA
const enableResponse = await fetch('/api/v1/auth/2fa/enable', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${accessToken}` },
  body: JSON.stringify({ setupToken, totpCode })
});

if (enableResponse.ok) {
  alert('2FA enabled successfully!');
}
```

### 2. Login with 2FA

Modify login flow to handle 2FA:

```javascript
// Step 1: Regular login
const loginResponse = await fetch('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});

const loginData = await loginResponse.json();

// Step 2: Check if 2FA is required
if (loginData.requiresTwoFA) {
  // Show 2FA prompt to user
  const totpCode = prompt('Enter the 6-digit code from your authenticator app');
  
  // Step 3: Verify 2FA code
  const twoFAResponse = await fetch('/api/v1/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({
      userId: loginData.user.id,
      totpCode: totpCode
    })
  });
  
  const twoFAData = await twoFAResponse.json();
  localStorage.setItem('accessToken', twoFAData.token);
  localStorage.setItem('refreshToken', twoFAData.refreshToken);
} else {
  // Regular login (no 2FA)
  localStorage.setItem('accessToken', loginData.token);
  localStorage.setItem('refreshToken', loginData.refreshToken);
}
```

### 3. Backup Codes

Allow users to use backup codes if they lose access to authenticator:

```javascript
// In 2FA verification step, allow user to enter backup code instead
const backupCode = prompt('Or enter one of your backup codes');

const twoFAResponse = await fetch('/api/v1/auth/2fa/verify', {
  method: 'POST',
  body: JSON.stringify({
    userId: loginData.user.id,
    backupCode: backupCode
  })
});
```

### 4. Disable 2FA

Allow users to disable 2FA:

```javascript
const response = await fetch('/api/v1/auth/2fa/disable', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${accessToken}` },
  body: JSON.stringify({
    password: userPassword,
    totpCode: userTotpCode
  })
});

if (response.ok) {
  alert('2FA disabled successfully');
}
```

### 5. Regenerate Backup Codes

Allow users to get new backup codes:

```javascript
const response = await fetch('/api/v1/auth/2fa/backup-codes', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${accessToken}` },
  body: JSON.stringify({ totpCode: userTotpCode })
});

const { backupCodes } = await response.json();
// Display new backup codes to user
```

### 6. Check 2FA Status

Check if user has 2FA enabled:

```javascript
const response = await fetch('/api/v1/auth/2fa/status', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const { enabled, enabledAt, backupCodesRemaining } = await response.json();

if (enabled) {
  console.log(`2FA enabled since ${enabledAt}`);
  console.log(`Backup codes remaining: ${backupCodesRemaining}`);
}
```

## For Backend Developers

### Import and Use

```javascript
const twoFAUtils = require('./utils/2fa');
const twoFAConfig = require('./config/2fa');

// Setup 2FA
const { secret, qrCode, backupCodes } = await twoFAUtils.setup2FA('user@example.com');

// Verify TOTP token
const isValid = twoFAUtils.verify2FAToken('123456', secret);

// Verify backup code
const isValid = twoFAUtils.verifyBackupCode('12345678', hashedBackupCodes);

// Regenerate backup codes
const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();
```

### Add to Existing Routes

To add 2FA to another route:

```javascript
const twoFAUtils = require('../utils/2fa');

router.post('/protected-action', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  
  // Require 2FA verification for sensitive action
  if (user.twoFAEnabled) {
    const { totpCode } = req.body;
    const isValid = twoFAUtils.verify2FAToken(totpCode, user.twoFASecret);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }
  }
  
  // Continue with protected action
});
```

## Authenticator Apps to Test With

Popular authenticator apps:
- **Google Authenticator** - iOS/Android
- **Authy** - iOS/Android/Desktop/Browser
- **Microsoft Authenticator** - iOS/Android
- **FreeOTP** - iOS/Android (open source)
- **Aegis Authenticator** - Android (open source)
- **KeePass** - Desktop (with plugin)
- **1Password** - iOS/Android/Desktop

### Testing

For testing, you can manually calculate TOTP codes:

```javascript
const speakeasy = require('speakeasy');

// Calculate current TOTP code
const code = speakeasy.totp({
  secret: 'BASE32_ENCODED_SECRET',
  encoding: 'base32'
});

console.log(`Current TOTP code: ${code}`);
```

## Database Schema

The 2FA data is stored in the User table:

```sql
-- Check if columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name='User' AND column_name LIKE '%twoFA%';

-- View user 2FA status
SELECT id, email, twoFAEnabled, twoFAEnabledAt 
FROM "User" 
WHERE twoFAEnabled = true;

-- Check backup codes (stored as JSON)
SELECT id, email, twoFABackupCodes 
FROM "User" 
WHERE twoFAEnabled = true AND twoFABackupCodes IS NOT NULL;
```

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `SETUP_ERROR` | Error during setup | Retry setup |
| `ENABLE_ERROR` | Error enabling 2FA | Retry enable |
| `VERIFY_ERROR` | Error verifying code | Retry verification |
| `BACKUP_CODES_ERROR` | Error with backup codes | Contact support |
| `DISABLE_ERROR` | Error disabling 2FA | Retry disable |
| `STATUS_ERROR` | Error checking status | Retry status |

## Common Issues

### QR Code Won't Scan
- Try different lighting
- Try different authenticator app
- Manually enter the secret key

### TOTP Code Always Wrong
- Verify device clock is synced
- Check 6-digit code format
- Try regenerating setup

### Can't Disable 2FA
- Ensure you have correct password
- Ensure TOTP code is valid and current
- Try again in a few moments

### Lost All Backup Codes
- Use TOTP from authenticator if still working
- Contact admin to disable 2FA
- Set up new 2FA afterward

## Testing Checklist

- [ ] User can setup 2FA
- [ ] User receives valid QR code
- [ ] User can scan QR code with authenticator
- [ ] User can verify TOTP code
- [ ] 2FA is enabled in database
- [ ] Login requires 2FA code when enabled
- [ ] Backup codes work for login
- [ ] Each backup code works only once
- [ ] User can regenerate backup codes
- [ ] User can disable 2FA
- [ ] User can check 2FA status

## Environment Variables

No new environment variables needed. Uses existing:
- `JWT_SECRET` - for token signing
- `DATABASE_URL` - for storing 2FA data
- `NODE_ENV` - for security settings

## Logging

2FA operations are logged:

```
logger.info('2FA enabled for user', { userId })
logger.warn('Backup code used for 2FA', { userId })
logger.info('2FA disabled for user', { userId })
logger.error('Error setting up 2FA', { email, error })
```

Check logs:
```bash
grep "2FA" logs/app.log
```

## API Versions

2FA is available in API v1:
- `/api/v1/auth/2fa/setup`
- `/api/v1/auth/2fa/enable`
- `/api/v1/auth/2fa/verify`
- `/api/v1/auth/2fa/backup-codes`
- `/api/v1/auth/2fa/disable`
- `/api/v1/auth/2fa/status`

## Next Steps

1. **Test the endpoints** using Postman or curl
2. **Build UI screens** for setup and verification
3. **Integrate with mobile app** following the same API
4. **Monitor adoption** and user feedback
5. **Consider mandatory 2FA** for admin accounts

## Support

For detailed documentation, see `docs/2FA_IMPLEMENTATION.md`
