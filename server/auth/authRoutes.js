const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/queries');
const { authenticate, requireRole, generateToken } = require('./authMiddleware');

const router = express.Router();

// Login and first-user signup are public; everything else needs a valid token.
const PUBLIC_PATHS = new Set(['/login', '/signup']);
router.use((req, res, next) => (PUBLIC_PATHS.has(req.path) ? next() : authenticate(req, res, next)));

router.use((req, res, next) => {
  if (!process.env.JWT_SECRET) {
    return res.status(400).json({ error: 'AUTH_DISABLED', message: 'Set JWT_SECRET in .env to enable accounts' });
  }
  next();
});

/**
 * The very first account can sign up freely (it becomes the admin).
 * After that, only a logged-in admin can create accounts.
 */
function signupGate(req, res, next) {
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) return next();
  authenticate(req, res, () => requireRole('admin')(req, res, next));
}

/**
 * POST /api/auth/signup
 * Create a new account and organization.
 */
router.post('/signup', signupGate, async (req, res) => {
  const { email, password, name, orgName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 6 characters' });
  }

  const db = getDb();

  try {
    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Admin-created accounts join the admin's org as members; the first account is the admin
    let orgId = req.user?.orgId || null;
    const role = req.user ? 'member' : 'admin';
    if (orgName && !req.user) {
      const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const orgResult = db.prepare(
        'INSERT INTO organizations (name, slug) VALUES (?, ?)'
      ).run(orgName, slug);
      orgId = orgResult.lastInsertRowid;
    }

    // Create user
    const userResult = db.prepare(
      'INSERT INTO users (email, password_hash, name, org_id, role) VALUES (?, ?, ?, ?, ?)'
    ).run(email, passwordHash, name || null, orgId, role);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userResult.lastInsertRowid);
    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        orgId: user.org_id,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[Auth] Signup error:', err.message);
    res.status(500).json({ error: 'SIGNUP_FAILED', message: err.message });
  }
});

/**
 * POST /api/auth/login
 * Authenticate and return a JWT token.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'email and password are required' });
  }

  const db = getDb();

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        orgId: user.org_id,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'LOGIN_FAILED', message: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user.
 */
router.get('/me', (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, email, name, org_id, role, created_at FROM users WHERE id = ?').get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
  }

  let org = null;
  if (user.org_id) {
    org = db.prepare('SELECT id, name, slug FROM organizations WHERE id = ?').get(user.org_id);
  }

  res.json({ user, organization: org });
});

module.exports = router;
