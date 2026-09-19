const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware (I1)
 * 
 * JWT-based authentication. If JWT_SECRET is not set,
 * auth is effectively bypassed (single-user mode).
 */

/**
 * Middleware to verify JWT token.
 * If auth is not configured, passes through (single-user mode).
 */
function authenticate(req, res, next) {
  // If no JWT_SECRET is configured, skip auth (single-user mode)
  if (!process.env.JWT_SECRET) {
    req.user = { id: 1, email: 'admin@localhost', orgId: null, role: 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired token' });
  }
}

/**
 * Middleware to require a specific role.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Middleware to scope queries by organization.
 * Adds orgId to req for use in query functions.
 */
function scopeByOrg(req, res, next) {
  if (req.user && req.user.orgId) {
    req.orgId = req.user.orgId;
  }
  next();
}

/**
 * Generate a JWT token for a user.
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      orgId: user.org_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authenticate, requireRole, scopeByOrg, generateToken };
