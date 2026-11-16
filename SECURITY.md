# Admin access and paid lead verification

Admin login is POST /api/admin/login with a password. ADMIN_PASSWORD_HASH must be a salted scrypt digest, in the form scrypt:<32 hex salt>:<128 hex digest>, generated with Node's default scrypt parameters and a 64-byte output. Never commit a password or its production hash. Missing configuration fails closed.

Login issues a random bearer session, valid for one hour. The frontend keeps it only in memory, never local storage or a cookie. Reload, expiry or backend restart requires signing in again. Lock Vault revokes the current session. Login is rate limited to 10 attempts per 15 minutes per IP. Render's single reverse proxy is trusted for client IP rate limiting.

Admin requests must include Authorization: Bearer <session>. Tutor moderation, job changes, unmasked job reads and unlock records require it. Public jobs stay masked; unauthenticated job submissions stay pending. Legacy query secrets grant no permissions. Public tutor registration cannot assign approval or paid flags.

Paid unlock orders cost INR 49 as before. Orders are bound to the chosen job and tutor phone in server-set Razorpay notes. Contact release verifies the signature and checks the order, purpose, amount, currency, phone, job and captured payment with Razorpay. An authorized but not yet captured payment returns 409; checkout retries confirmation up to five times without creating or charging a second order. Unconfirmed payments do not release a contact. Retries for the same order cannot unlock a different lead.

Run npm test for isolated auth/payment/public-flow checks. Tests do not connect to production MongoDB or charge a payment. Successful captured-payment verification is covered with a mocked gateway; an actual charged checkout was not run as part of this change.
