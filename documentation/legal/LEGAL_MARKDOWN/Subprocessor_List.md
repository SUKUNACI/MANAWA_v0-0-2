# 🔗 SUBPROCESSOR LIST — MANAWA

**Effective Date:** 2026-11-14  
**Last Updated:** 2026-11-14

---

## DEFINITION

A Subprocessor is any third-party service provider that processes personal data on behalf of MANAWA. This includes:
- Payment processors
- Email/SMS providers
- Analytics tools
- Cloud storage
- Notification services

---

## CURRENT SUBPROCESSORS

### **1. GeniusPay** 💳

| Detail | Value |
|--------|-------|
| Purpose | Payment processing |
| Data processed | Transactions, amounts, timestamps |
| DPA signed | ✅ Yes |
| Location | EU (France) |
| Sub-processors | Stripe (payment gateway) |
| Contact | compliance@geniuspay.com |

**What they access:**
- Transaction amounts
- Payment status
- Customer emails (for receipts)
- NOT: Credit card numbers

---

### **2. Firebase** 🔥

| Detail | Value |
|--------|-------|
| Purpose | Push notifications, cloud functions |
| Data processed | User IDs, device tokens, message data |
| DPA signed | ✅ Yes (Google Standard Processor Agreement) |
| Location | US + EU (multi-region) |
| Sub-processors | Google Cloud (storage) |
| Contact | support@firebase.google.com |

**What they access:**
- Device tokens for notifications
- User preferences
- Push message content
- Analytics data

---

### **3. Mailjet** 📧

| Detail | Value |
|--------|-------|
| Purpose | Transactional email (receipts, confirmations) |
| Data processed | Email addresses, user names, content |
| DPA signed | ✅ Yes |
| Location | EU (France) |
| Sub-processors | AWS (hosting) |
| Contact | support@mailjet.com |

**What they access:**
- Recipient email addresses
- Email templates
- User names
- NOT: Passwords or payment data

---

### **4. Twilio** 📱

| Detail | Value |
|--------|-------|
| Purpose | SMS notifications |
| Data processed | Phone numbers, SMS content |
| DPA signed | ✅ Yes |
| Location | US (California) |
| Sub-processors | Nexmo (carrier routing) |
| Contact | legal@twilio.com |

**What they access:**
- Phone numbers
- SMS message content
- Delivery status
- NOT: Financial data

---

### **5. Cloudinary** 🖼️

| Detail | Value |
|--------|-------|
| Purpose | Image/video storage and CDN |
| Data processed | User-uploaded images, videos, metadata |
| DPA signed | ✅ Yes |
| Location | US + EU (multi-region) |
| Sub-processors | AWS (hosting) |
| Contact | support@cloudinary.com |

**What they access:**
- User-uploaded files
- File metadata
- Access logs
- NOT: Personal data beyond uploads

---

### **6. Google Analytics** 📊

| Detail | Value |
|--------|-------|
| Purpose | Website analytics |
| Data processed | Anonymous usage data, cookies |
| DPA signed | ✅ Yes (Google Standard Processor Agreement) |
| Location | US (California) |
| Sub-processors | Google Cloud (infrastructure) |
| Contact | privacy@google.com |

**What they access:**
- Anonymized user behavior
- Page views, clicks, scroll depth
- Device type, browser, location
- NOT: Personal identifiable information (unless user consents)

---

### **7. AWS** ☁️

| Detail | Value |
|--------|-------|
| Purpose | Cloud infrastructure (hosting, backups) |
| Data processed | All application data |
| DPA signed | ✅ Yes (AWS Data Processing Amendment) |
| Location | EU Ireland |
| Sub-processors | Multiple (storage, compute, networking) |
| Contact | privacy@amazon.com |

**What they access:**
- All database backups
- Application files
- Log files
- Configuration data

---

### **8. Sentry** 🐛

| Detail | Value |
|--------|-------|
| Purpose | Error tracking and monitoring |
| Data processed | Error logs, stack traces |
| DPA signed | ✅ Yes |
| Location | US + EU (configurable) |
| Sub-processors | AWS (hosting) |
| Contact | support@sentry.io |

**What they access:**
- Application error details
- Stack traces
- Environment variables
- User context (for debugging)

---

## NOTIFICATION OF CHANGES

When MANAWA adds a new subprocessor:

1. **At least 30 days advance notice** to customers
2. **Opportunity to object** to new processors
3. **Updated DPA** signed before data transfer
4. **Updated Privacy Policy** reflecting new processor

---

## DATA PROTECTION COMMITMENTS

All subprocessors commit to:

✅ **GDPR Compliance**
- Standard Contractual Clauses
- Data protection agreements
- Regular security audits

✅ **Security Standards**
- Encryption in transit and at rest
- Access controls and authentication
- Incident response procedures
- Regular security updates

✅ **Data Minimization**
- Process only necessary data
- Delete data when no longer needed
- Secure deletion procedures

---

## CONTACT & REQUESTS

**For questions about subprocessors:**

Email: privacy@manawa.app  
Subject: "Subprocessor Request"

**Data subject rights requests:**

1. **Access data:** Contact MANAWA
2. **Delete data:** Contact MANAWA (we instruct processors)
3. **Object to processor:** Contact MANAWA (30-day objection period)

---

## AUDIT & VERIFICATION

MANAWA conducts:

- ✅ Annual DPA review
- ✅ Subprocessor compliance audit
- ✅ Security assessment
- ✅ Breach simulation testing

Results available upon request.

---

**Last Updated:** 2026-11-14  
**Next Review:** 2027-11-14
