const crypto = require('node:crypto');
const { promisify } = require('node:util');
const rateLimit = require('express-rate-limit');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 60 * 60 * 1000;

function createAdminAuth(passwordHash = process.env.ADMIN_PASSWORD_HASH) {
  const sessions = new Map();
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const readSession = req => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '')?.[1];
    if (!token) return null;
    const key = digest(token);
    const expiry = sessions.get(key);
    if (!expiry || expiry <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    return { key, expiry };
  };
  const attach = (req, res, next) => {
    req.adminSession = readSession(req);
    // A supplied but invalid token must never fall back to public write behavior.
    if (req.get('authorization') && !req.adminSession) {
      return res.status(401).json({ error: 'Admin session expired. Please sign in again.' });
    }
    next();
  };
  const requireAdmin = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.adminSession) return res.status(401).json({ error: 'Admin sign-in required.' });
    next();
  };
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' }
  });
  const login = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(passwordHash || '');
    if (!match) return res.status(503).json({ error: 'Admin sign-in is not configured.' });
    const password = req.body?.password;
    if (typeof password !== 'string' || !password || password.length > 256) {
      return res.status(401).json({ error: 'Access denied.' });
    }
    try {
      const actual = await scrypt(password, match[1], 64);
      if (!crypto.timingSafeEqual(actual, Buffer.from(match[2], 'hex'))) {
        return res.status(401).json({ error: 'Access denied.' });
      }
      for (const [key, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(key);
      if (sessions.size >= 1000) return res.status(503).json({ error: 'Please try again later.' });
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_MS;
      sessions.set(digest(token), expiresAt);
      return res.json({ token, expiresAt });
    } catch {
      return res.status(503).json({ error: 'Admin sign-in is temporarily unavailable.' });
    }
  };
  const logout = (req, res) => {
    if (req.adminSession) sessions.delete(req.adminSession.key);
    res.set('Cache-Control', 'no-store').status(204).end();
  };
  return { attach, requireAdmin, loginLimiter, login, logout };
}
module.exports = { createAdminAuth, SESSION_MS };
