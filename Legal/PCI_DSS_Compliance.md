# 💳 PCI-DSS COMPLIANCE — MANAWA

**Applicable à:** Payment processing via GeniusPay  
**Last Updated:** 2026-11-14

---

## ✅ PCI-DSS REQUIREMENTS

### 1. **Install and Maintain Firewall**
- [x] Firewall enabled on all backend infrastructure
- [x] All unnecessary ports closed
- [x] Only ports 80, 443, 3000 open
- [x] Database on private network

### 2. **Protect Stored Data**
- [x] Credit card data NOT stored locally (GeniusPay handles)
- [x] Database encryption enabled
- [x] Backups encrypted
- [x] No card numbers in logs

### 3. **Encrypt Data in Transit**
- [x] HTTPS/TLS 1.2+ on all endpoints
- [x] Secure certificate installed
- [x] All API calls encrypted
- [x] WebSocket connections encrypted

### 4. **Access Control**
- [x] Role-based access control (RBAC) implemented
- [x] Users see only their own data
- [x] Admin access restricted
- [x] Access logs maintained

### 5. **Monitoring**
- [x] Firewall logs reviewed
- [x] Intrusion detection enabled
- [x] Unauthorized attempts logged
- [x] Alert system active

### 6. **Security Policies**
- [x] Data retention policy documented
- [x] Incident response procedure ready
- [x] Staff training required
- [x] Compliance audit scheduled

---

## 🔐 THIRD-PARTY: GeniusPay

**GeniusPay handles:**
- ✅ PCI-DSS Level 1 certification
- ✅ Card tokenization
- ✅ Secure payment processing
- ✅ Data encryption

**MANAWA stores ONLY:**
- Transaction IDs
- Amounts
- Timestamps
- Payment status
- User IDs

**MANAWA NEVER stores:**
- Credit card numbers
- CVV codes
- Cardholder names
- Bank account numbers

---

## 📊 COMPLIANCE STATUS

| Control | Status |
|---------|--------|
| HTTPS/TLS | ✅ |
| Firewall | ✅ |
| Encryption | ✅ |
| Access Controls | ✅ |
| Logging | ✅ |
| DPA | ✅ |
