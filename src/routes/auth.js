const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { generateToken, auth, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Login e senha obrigatorios' });

  const user = await db.get(
    'SELECT * FROM users WHERE login = $1 AND active = 1',
    [login.toLowerCase().trim()]
  );
  if (!user) return res.status(401).json({ error: 'Usuario ou senha incorretos' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Usuario ou senha incorretos' });

  const token = generateToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, login: user.login, role: user.role, store: user.store },
  });
}));

// GET /api/auth/me
router.get('/me', auth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

// PUT /api/auth/password
router.put('/password', auth, asyncHandler(async (req, res) => {
  const { current, newPassword } = req.body;
  if (!current || !newPassword) return res.status(400).json({ error: 'Senhas obrigatorias' });

  const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!bcrypt.compareSync(current, user.password)) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run(
    'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
    [hash, req.user.id]
  );
  res.json({ message: 'Senha alterada' });
}));

module.exports = router;