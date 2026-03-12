const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { auth, roles, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// GET /api/users
router.get('/', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const users = await db.all(
    'SELECT id, name, login, role, store, active, created_at FROM users ORDER BY name'
  );
  res.json(users);
}));

// POST /api/users
router.post('/', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name, login, password, role, store } = req.body;
  if (!name || !login || !password) return res.status(400).json({ error: 'Campos obrigatorios' });

  const exists = await db.get(
    'SELECT id FROM users WHERE login = $1',
    [login.toLowerCase().trim()]
  );
  if (exists) return res.status(409).json({ error: 'Login ja existe' });
  if (role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas admin cria admin' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await db.run(
    'INSERT INTO users (name, login, password, role, store) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name.trim(), login.toLowerCase().trim(), hash, role || 'vendedor', store || '']
  );
  res.status(201).json({ id: result.lastInsertRowid, message: 'Usuario criado' });
}));

// PUT /api/users/:id
router.put('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name, login, password, role, store, active } = req.body;

  const user = await db.get('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Nao encontrado' });
  if (user.role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Sem permissao' });
  }

  const sets = [];
  const params = [];
  let i = 1;

  if (name     !== undefined) { sets.push(`name = $${i++}`);       params.push(name.trim()); }
  if (login    !== undefined) { sets.push(`login = $${i++}`);      params.push(login.toLowerCase().trim()); }
  if (password)               { sets.push(`password = $${i++}`);   params.push(bcrypt.hashSync(password, 10)); }
  if (role     !== undefined) { sets.push(`role = $${i++}`);       params.push(role); }
  if (store    !== undefined) { sets.push(`store = $${i++}`);      params.push(store); }
  if (active   !== undefined) { sets.push(`active = $${i++}`);     params.push(active ? 1 : 0); }

  if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

  sets.push(`updated_at = NOW()`);
  params.push(req.params.id);

  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, params);
  res.json({ message: 'Atualizado' });
}));

// DELETE /api/users/:id
router.delete('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const user = await db.get('SELECT role FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Nao encontrado' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Nao pode excluir admin' });

  await db.run('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ message: 'Excluido' });
}));

module.exports = router;