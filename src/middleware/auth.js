const jwt = require('jsonwebtoken');
const { db } = require('../database');

const SECRET = process.env.JWT_SECRET || 'msconnect_default_secret';

// Gerar token JWT
function generateToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role, name: user.name, store: user.store },
    SECRET,
    { expiresIn: (process.env.JWT_EXPIRES || 24) + 'h' }
  );
}

// Middleware: verificar token e carregar user do banco
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token nao fornecido' });

  const token = header.startsWith('Bearer ') ? header.slice(7) : header;

  // Cron interno: bypass simplificado (chamada do proprio servidor)
  if (token === 'cron-internal') {
    req.user = { id: 0, name: 'cron', login: 'cron', role: 'admin', store: '' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = await db.get(
      'SELECT id, name, login, role, store, active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario inativo' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

// Middleware: restringir por role
function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nao autenticado' });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissao' });
    next();
  };
}

// Helpers de permissao
function canSeeAll(user) {
  return ['admin', 'diretor', 'analista'].includes(user.role);
}

function canManage(user) {
  return ['admin', 'analista'].includes(user.role);
}

function canDelete(user) {
  return ['admin', 'analista'].includes(user.role);
}

// Wrapper para handlers async (captura erros e envia para o error middleware)
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { generateToken, auth, roles, canSeeAll, canManage, canDelete, asyncHandler };