-- One-time / operator: idempotent if role is already 'admin'.
-- Safe: updates a single known platform admin row only. Run against the same database as the app.
-- After this, verify with GET /api/v1/auth/me (user must be signed in; role comes from DB per request).
UPDATE users
SET role = 'admin'
WHERE LOWER(email) = LOWER('admin@eduversejo.com');
