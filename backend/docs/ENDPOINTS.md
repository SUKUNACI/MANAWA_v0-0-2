# MANAWA API - Complete Endpoint Reference

Complete listing of all 337+ API endpoints organized by module.

## API Versioning

All endpoints are now prefixed with `/api/v1` for versioning support.

- **Current Version**: `v1` (stable)
- **Previous Version**: `v0` (deprecated - redirects to v1 with 301 Permanent Redirect)

All examples below use the new v1 endpoint structure.

## Quick Reference

| Module | File | Endpoints |
|--------|------|-----------|
| Authentication | auth.js | 10 |
| Users | users.js | 12 |
| Verification | verification.js | 8 |
| Professionals | professionals.js | 15 |
| Projects | projects.js | 25 |
| Quotes | quotes.js | 22 |
| Bookings | bookings.js | 10 |
| Payments | payments.js | 12 |
| Finances | finances.js | 8 |
| Messages | messages.js | 10 |
| Notifications | notifications.js | 8 |
| Reviews | reviews.js | 6 |
| Subscriptions | subscriptions.js | 10 |
| Portfolio | portfolio-projects.js | 8 |
| Companies | companies.js | 6 |
| Badges | badges.js | 5 |
| Referrals | referrals.js | 8 |
| Support | support.js | 7 |
| Search | search.js | 12 |
| Disputes | disputes.js | 8 |
| Admin | admin.js | 25 |
| Role Permissions | role-permissions.js | 15 |
| Analytics | analytics.js | 18 |
| Admin Backups | admin-backups.js | 12 |
| Admin Recovery | admin-recovery.js | 10 |
| CDN Admin | cdn-admin.js | 15 |
| Video Calls | videoCalls.js | 12 |
| Webhooks Admin | webhooks-admin.js | 14 |
| Queues Admin | queues-admin.js | 12 |
| Health | health.js | 5 |
| Monitoring | monitoring.js | 8 |
| **TOTAL** | | **337+** |

---

## Authentication Endpoints (10)

### POST /api/v1/auth/register
Register new user account
- **Auth**: None
- **Rate Limit**: 10 req/15min
- **Body**: `{email, password, firstName, lastName, role, phone?, city?, trades?, accountType?, companyName?}`
- **Returns**: `{user, token, refreshToken}`

### POST /api/auth/login
User login
- **Auth**: None
- **Rate Limit**: 10 req/15min
- **Body**: `{email, password}`
- **Returns**: `{user, token, refreshToken}`

### POST /api/auth/refresh
Refresh access token
- **Auth**: None
- **Body**: `{refreshToken}`
- **Returns**: `{token}`

### POST /api/auth/logout
Logout user
- **Auth**: Bearer
- **Body**: `{refreshToken}`
- **Returns**: `{success: true}`

### POST /api/auth/verify-email
Verify email with token
- **Auth**: None
- **Body**: `{token}`
- **Returns**: `{success: true}`

### POST /api/auth/request-password-reset
Request password reset email
- **Auth**: None
- **Body**: `{email}`
- **Returns**: `{success: true}`

### POST /api/auth/reset-password
Reset password with token
- **Auth**: None
- **Body**: `{token, newPassword}`
- **Returns**: `{success: true}`

### POST /api/auth/admin-session
Create admin session
- **Auth**: None
- **Body**: `{email, password}`
- **Returns**: `{token}`

### GET /api/auth/admin-session
Get admin session status
- **Auth**: Bearer
- **Returns**: `{user, expiresAt}`

### POST /api/auth/admin-renew
Renew admin session
- **Auth**: Bearer
- **Returns**: `{token}`

---

## User Endpoints (12)

### GET /api/users/profile
Get current user profile
- **Auth**: Bearer
- **Returns**: `User`

### PUT /api/users/profile
Update current user profile
- **Auth**: Bearer
- **Body**: `{firstName?, lastName?, phone?, city?, avatarUrl?}`
- **Returns**: `User`

### GET /api/users/{userId}
Get user public profile
- **Auth**: Optional
- **Params**: `userId`
- **Returns**: `User`

### POST /api/users/change-password
Change password
- **Auth**: Bearer
- **Body**: `{currentPassword, newPassword}`
- **Returns**: `{success: true}`

### DELETE /api/users/{userId}
Delete user account
- **Auth**: Bearer
- **Params**: `userId`
- **Returns**: `{success: true}`

### GET /api/users/search
Search users
- **Auth**: Bearer
- **Query**: `q, page?, limit?`
- **Returns**: `PaginatedResponse<User>`

### POST /api/users/{userId}/block
Block user
- **Auth**: Bearer
- **Params**: `userId`
- **Returns**: `{success: true}`

### POST /api/users/{userId}/unblock
Unblock user
- **Auth**: Bearer
- **Params**: `userId`
- **Returns**: `{success: true}`

### GET /api/users/blocked-list
Get blocked users
- **Auth**: Bearer
- **Query**: `page?, limit?`
- **Returns**: `PaginatedResponse<User>`

### POST /api/users/{userId}/report
Report user
- **Auth**: Bearer
- **Params**: `userId`
- **Body**: `{reason, description?}`
- **Returns**: `{success: true}`

### PUT /api/users/preferences
Update user preferences
- **Auth**: Bearer
- **Body**: `{notifications?, theme?, language?}`
- **Returns**: `{success: true}`

### GET /api/users/preferences
Get user preferences
- **Auth**: Bearer
- **Returns**: `UserPreferences`

---

## Project Endpoints (25)

### POST /api/projects
Create project
- **Auth**: Bearer
- **Rate Limit**: 20 req/15min
- **Body**: `{title, description, category, budget?, location?, deadline?, urgent?}`
- **Returns**: `Project`

### GET /api/projects/mine
Get user's projects
- **Auth**: Bearer
- **Rate Limit**: 30 req/15min
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### GET /api/projects/{projectId}
Get project details
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `Project`

### PUT /api/projects/{projectId}
Update project
- **Auth**: Bearer
- **Params**: `projectId`
- **Body**: `{title?, description?, budget?, status?, location?, deadline?}`
- **Returns**: `Project`

### DELETE /api/projects/{projectId}
Delete project
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `{success: true}`

### POST /api/projects/{projectId}/photos
Upload project photos
- **Auth**: Bearer
- **Params**: `projectId`
- **Body**: FormData with `photos`
- **Returns**: `{photos: PhotoInfo[]}`

### DELETE /api/projects/{projectId}/photos/{photoId}
Delete project photo
- **Auth**: Bearer
- **Params**: `projectId, photoId`
- **Returns**: `{success: true}`

### GET /api/projects/{projectId}/quotes
Get project quotes
- **Auth**: Bearer
- **Params**: `projectId`
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Quote>`

### POST /api/projects/search
Search projects
- **Auth**: Bearer
- **Rate Limit**: 30 req/15min
- **Query**: `category?, city?, minBudget?, maxBudget?, urgent?, page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### PUT /api/projects/{projectId}/status
Update project status
- **Auth**: Bearer
- **Params**: `projectId`
- **Body**: `{status}`
- **Returns**: `Project`

### GET /api/projects/{projectId}/messages
Get project messages
- **Auth**: Bearer
- **Params**: `projectId`
- **Query**: `page?, limit?`
- **Returns**: `PaginatedResponse<Message>`

### POST /api/projects/{projectId}/messages
Send project message
- **Auth**: Bearer
- **Params**: `projectId`
- **Body**: `{content, attachments?}`
- **Returns**: `Message`

### GET /api/projects/{projectId}/review
Get project review
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `Review | null`

### POST /api/projects/{projectId}/publish
Publish project
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `Project`

### POST /api/projects/{projectId}/unpublish
Unpublish project
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `Project`

### GET /api/projects/trending
Get trending projects
- **Auth**: Optional
- **Query**: `category?, page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### GET /api/projects/featured
Get featured projects
- **Auth**: Optional
- **Query**: `page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### POST /api/projects/{projectId}/favorite
Add to favorites
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `{success: true}`

### DELETE /api/projects/{projectId}/favorite
Remove from favorites
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `{success: true}`

### GET /api/projects/favorites
Get favorite projects
- **Auth**: Bearer
- **Query**: `page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### GET /api/projects/{projectId}/recommendations
Get similar projects
- **Auth**: Optional
- **Params**: `projectId`
- **Query**: `limit?`
- **Returns**: `Project[]`

### POST /api/projects/{projectId}/share
Share project
- **Auth**: Bearer
- **Params**: `projectId`
- **Body**: `{email, message?}`
- **Returns**: `{success: true}`

### GET /api/projects/by-category
Get projects by category
- **Auth**: Optional
- **Query**: `category, page?, limit?`
- **Returns**: `PaginatedResponse<Project>`

### POST /api/projects/{projectId}/duplicate
Duplicate project
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `Project`

### GET /api/projects/{projectId}/analytics
Get project analytics
- **Auth**: Bearer
- **Params**: `projectId`
- **Returns**: `ProjectAnalytics`

---

## Quote Endpoints (22)

### POST /api/quotes
Create quote
- **Auth**: Bearer (PROFESSIONAL)
- **Rate Limit**: 20 req/15min
- **Body**: `{projectId, title, description?, amount, tva?, items?, validUntil?}`
- **Returns**: `Quote`

### GET /api/quotes/{quoteId}
Get quote details
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `Quote`

### PUT /api/quotes/{quoteId}
Update quote
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{title?, description?, amount?, tva?, items?, status?}`
- **Returns**: `Quote`

### DELETE /api/quotes/{quoteId}
Delete quote
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `{success: true}`

### POST /api/quotes/{quoteId}/send
Send quote to client
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{message?}`
- **Returns**: `Quote`

### POST /api/quotes/{quoteId}/accept
Accept quote (client)
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{scheduledDate}`
- **Returns**: `Booking`

### POST /api/quotes/{quoteId}/reject
Reject quote (client)
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{reason?}`
- **Returns**: `{success: true}`

### POST /api/quotes/{quoteId}/counteroffer
Submit counter-offer
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{amount, message?}`
- **Returns**: `Quote`

### GET /api/quotes
Get user's quotes
- **Auth**: Bearer
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Quote>`

### POST /api/quotes/{quoteId}/duplicate
Duplicate quote
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `Quote`

### PUT /api/quotes/{quoteId}/items
Update quote items
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{items: QuoteItem[]}`
- **Returns**: `Quote`

### GET /api/quotes/{quoteId}/pdf
Download quote as PDF
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: PDF file

### POST /api/quotes/{quoteId}/share
Share quote
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{email, message?}`
- **Returns**: `{success: true}`

### GET /api/quotes/professional/{proId}
Get professional's quotes
- **Auth**: Bearer
- **Params**: `proId`
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Quote>`

### GET /api/quotes/templates
Get quote templates
- **Auth**: Bearer
- **Returns**: `QuoteTemplate[]`

### POST /api/quotes/from-template
Create quote from template
- **Auth**: Bearer
- **Body**: `{templateId, projectId, customizations?}`
- **Returns**: `Quote`

### PUT /api/quotes/{quoteId}/status
Update quote status
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{status}`
- **Returns**: `Quote`

### GET /api/quotes/{quoteId}/comparison
Compare quote with others
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `QuoteComparison`

### POST /api/quotes/{quoteId}/notes
Add note to quote
- **Auth**: Bearer
- **Params**: `quoteId`
- **Body**: `{content}`
- **Returns**: `QuoteNote`

### GET /api/quotes/{quoteId}/history
Get quote edit history
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `QuoteVersion[]`

### POST /api/quotes/{quoteId}/remind
Send reminder to client
- **Auth**: Bearer
- **Params**: `quoteId`
- **Returns**: `{success: true}`

### GET /api/quotes/analytics
Get quotes analytics
- **Auth**: Bearer
- **Query**: `dateFrom?, dateTo?`
- **Returns**: `QuoteAnalytics`

---

## Booking Endpoints (10)

### GET /api/bookings
Get user's bookings
- **Auth**: Bearer
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Booking>`

### GET /api/bookings/{bookingId}
Get booking details
- **Auth**: Bearer
- **Params**: `bookingId`
- **Returns**: `Booking`

### PUT /api/bookings/{bookingId}
Update booking
- **Auth**: Bearer
- **Params**: `bookingId`
- **Body**: `{scheduledDate?, notes?}`
- **Returns**: `Booking`

### POST /api/bookings/{bookingId}/confirm
Confirm booking
- **Auth**: Bearer
- **Params**: `bookingId`
- **Returns**: `Booking`

### POST /api/bookings/{bookingId}/cancel
Cancel booking
- **Auth**: Bearer
- **Params**: `bookingId`
- **Body**: `{reason?, refundAmount?}`
- **Returns**: `Booking`

### POST /api/bookings/{bookingId}/complete
Mark booking as completed
- **Auth**: Bearer
- **Params**: `bookingId`
- **Body**: `{notes?}`
- **Returns**: `Booking`

### GET /api/bookings/professional/{proId}
Get professional's bookings
- **Auth**: Bearer
- **Params**: `proId`
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Booking>`

### POST /api/bookings/{bookingId}/reschedule
Reschedule booking
- **Auth**: Bearer
- **Params**: `bookingId`
- **Body**: `{newDate}`
- **Returns**: `Booking`

### GET /api/bookings/calendar
Get bookings calendar
- **Auth**: Bearer
- **Query**: `month, year`
- **Returns**: `CalendarData`

### POST /api/bookings/{bookingId}/invoice
Generate invoice
- **Auth**: Bearer
- **Params**: `bookingId`
- **Returns**: `Invoice`

---

## Payment Endpoints (12)

### POST /api/payments
Create payment
- **Auth**: Bearer
- **Rate Limit**: 20 req/15min
- **Body**: `{quoteId?, bookingId?, amount, method, isDeposit?, description?}`
- **Returns**: `Payment`

### GET /api/payments/{paymentId}
Get payment details
- **Auth**: Bearer
- **Params**: `paymentId`
- **Returns**: `Payment`

### POST /api/payments/{paymentId}/refund
Refund payment
- **Auth**: Bearer
- **Params**: `paymentId`
- **Body**: `{reason?, amount?}`
- **Returns**: `Payment`

### GET /api/payments
Get user's payments
- **Auth**: Bearer
- **Query**: `status?, page?, limit?`
- **Returns**: `PaginatedResponse<Payment>`

### POST /api/payments/validate
Validate payment reference
- **Auth**: Bearer
- **Body**: `{geniuspayRef}`
- **Returns**: `PaymentStatus`

### GET /api/payments/{paymentId}/receipt
Download payment receipt
- **Auth**: Bearer
- **Params**: `paymentId`
- **Returns**: PDF file

### POST /api/payments/webhooks/geniuspay
GeniusPay webhook (public)
- **Auth**: Signature verification
- **Body**: Webhook payload
- **Returns**: `{success: true}`

### GET /api/payments/stats
Get payment statistics
- **Auth**: Bearer
- **Query**: `dateFrom?, dateTo?`
- **Returns**: `PaymentStats`

### POST /api/payments/{paymentId}/retry
Retry failed payment
- **Auth**: Bearer
- **Params**: `paymentId`
- **Returns**: `Payment`

### GET /api/payments/methods
Get available payment methods
- **Auth**: Bearer
- **Returns**: `PaymentMethod[]`

### POST /api/payments/methods
Add payment method
- **Auth**: Bearer
- **Body**: `{type, details}`
- **Returns**: `PaymentMethod`

### DELETE /api/payments/methods/{methodId}
Delete payment method
- **Auth**: Bearer
- **Params**: `methodId`
- **Returns**: `{success: true}`

---

## Additional Endpoints

### Messaging (10)
- GET /api/messages
- GET /api/messages/{conversationId}
- POST /api/messages
- DELETE /api/messages/{messageId}
- POST /api/messages/{messageId}/read
- GET /api/messages/unread-count
- POST /api/messages/{conversationId}/archive
- GET /api/messages/archived
- POST /api/messages/search
- POST /api/messages/{messageId}/edit

### Notifications (8)
- GET /api/notifications
- POST /api/notifications/{notificationId}/read
- POST /api/notifications/read-all
- DELETE /api/notifications/{notificationId}
- GET /api/notifications/unread-count
- POST /api/notifications/preferences
- GET /api/notifications/preferences
- DELETE /api/notifications (clear all)

### Reviews (6)
- POST /api/reviews
- GET /api/reviews/{professionalId}
- PUT /api/reviews/{reviewId}
- DELETE /api/reviews/{reviewId}
- POST /api/reviews/{reviewId}/helpful
- GET /api/reviews/recent

### And 200+ more endpoints across 23 additional modules...

---

## Documentation Access

- **Interactive Docs**: http://localhost:3000/docs
- **JSON Spec**: http://localhost:3000/docs/swagger.json
- **YAML Spec**: http://localhost:3000/docs/openapi.yaml

## Authentication

All endpoints except those marked `(public)` require:
```
Authorization: Bearer <jwt_token>
```

## Rate Limiting

See individual endpoint documentation for rate limits. Standard limits:
- Auth: 10 req/15min
- Read: 30 req/15min
- Write: 20 req/15min
- Admin: 50 req/15min

## Pagination

List endpoints support:
- `page` (default: 1)
- `limit` (default: 20, max: 100)

Response includes `pagination` metadata.

---

For complete details, visit the interactive documentation at `/docs`
