# Customer Portal API contract (portal.zanf.org -> zan-app-api /portal/*)

Server-to-server only. Switched by env `PORTAL_ENABLED=true` (off => 503, and the customer web sign-in block on app.zanf.org is also off).

## Signing
Headers: `X-Portal-Key-Id`, `X-Portal-Timestamp` (unix s, +-300 s), `X-Portal-Nonce` (32 hex, single use, stored in PortalNonce),
`X-Portal-Signature` = hex HMAC-SHA256(secret, `METHOD\nPATH?QUERY\nTIMESTAMP\nNONCE\nsha256hex(rawBody)`).
The acting user is the `uid` query parameter (so it is signed). Keys: env `PORTAL_BRIDGE_KEYS` = `keyId:secret,keyId2:secret2`.
Every call re-loads the user: must be active, role `customer`, with a customerId (taken from the DB row, never from the request).
Unknown id / cross-company record => 404. Responses pass a forbidden-key guard (no money, staff, vendor, internal, Drive fields).

## Routes
- POST /portal/auth/lookup {identifier} (no uid) -> {found, userId?, email?}. Email or mobile; shared mobile or no e-mail => found:false.
- GET /me, /catalogue (ratings), /document-types, /company-contact
- GET /orders?search&status&page, GET /orders/:id (id = `s_<submissionId>` or `o_<orderId>`), POST /orders (submission; idempotent on submissionKey)
- GET /sites/:id, /sites/:id/timeline, PATCH /sites/:id/contacts|access-notes|priority (body.version = site.updatedAt, 409 on mismatch; priority locked from stage 8)
- POST /sites/:id/documents/:typeKey (raw file body), GET /sites/:id/documents/:typeKey/content
- GET /updates?limit, GET /pending-actions, POST /pending-actions/:id/respond
- GET /complaints, GET /complaints/:id, POST /complaints, POST /complaints/:id/comments, POST /complaints/:id/reopen (closed, within 15 days of closedAt)
- POST /uploads?kind&draftId|siteId|complaintId&fileName (RAW body, max 4 MB; type by file signature: jpeg/png/webp/heic/pdf), GET /uploads/:id/content (owner check)

## Data model (additive migration 20261122120000_customer_portal)
Order<->Site is 1:1, so a portal submission creates one Order+Site per DG set, grouped by `PortalSubmission` (unique `submissionKey` = portal draft id = idempotency).
New: Site portal fields, PortalSubmission, ComplaintComment, PortalAttachment (file bytes in Postgres, private), PortalNonce, Order.portalSubmissionId, place_order grant.
