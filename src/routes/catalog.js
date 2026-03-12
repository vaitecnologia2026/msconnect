const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { auth, roles, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// =====================================================================
// Helper: CRUD genérico para tabelas com (name, value, obs)
// =====================================================================
function crudRoutes(table, label) {
  const r = express.Router();

  r.get('/', auth, asyncHandler(async (req, res) => {
    const rows = await db.all(`SELECT * FROM ${table} WHERE active = 1 ORDER BY name`);
    res.json(rows);
  }));

  r.post('/', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
    const { name, value, obs } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
    try {
      const result = await db.run(
        `INSERT INTO ${table} (name, value, obs) VALUES ($1, $2, $3) RETURNING id`,
        [name.trim(), value || 0, obs || '']
      );
      res.status(201).json({ id: result.lastInsertRowid, message: `${label} criado` });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Ja existe' });
      throw e;
    }
  }));

  r.post('/batch', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
    const { items } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Lista vazia' });

    let count = 0;
    await db.transaction(async (client) => {
      for (const item of items) {
        const nm = item.name?.trim();
        if (!nm) continue;
        await client.query(
          `INSERT INTO ${table} (name, value, obs) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [nm, item.value || 0, item.obs || '']
        );
        count++;
      }
    });
    res.json({ message: `${count} importados` });
  }));

  r.delete('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
    await db.run(`UPDATE ${table} SET active = 0 WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Removido' });
  }));

  return r;
}

// =====================================================================
// Lojas
// =====================================================================
router.get('/stores', auth, asyncHandler(async (req, res) => {
  res.json(await db.all('SELECT * FROM stores WHERE active = 1 ORDER BY name'));
}));

router.post('/stores', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  try {
    const r = await db.run('INSERT INTO stores (name) VALUES ($1) RETURNING id', [name.trim()]);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ja existe' });
    throw e;
  }
}));

router.delete('/stores/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('UPDATE stores SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removido' });
}));

// =====================================================================
// Vendedores
// =====================================================================
router.get('/sellers', auth, asyncHandler(async (req, res) => {
  res.json(await db.all('SELECT * FROM sellers WHERE active = 1 ORDER BY name'));
}));

router.post('/sellers', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name, store } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });

  const r = await db.run(
    'INSERT INTO sellers (name, store) VALUES ($1, $2) RETURNING id',
    [name.trim(), store || '']
  );

  // Auto-criar usuario
  const login = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '');

  const exists = await db.get('SELECT id FROM users WHERE login = $1', [login]);
  if (!exists) {
    const hash = bcrypt.hashSync('123456', 10);
    const userId = await db.run(
      'INSERT INTO users (name, login, password, role, store) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name.trim(), login, hash, 'vendedor', store || '']
    );
    await db.run('UPDATE sellers SET user_id = $1 WHERE id = $2', [userId.lastInsertRowid, r.lastInsertRowid]);
  }

  res.status(201).json({
    id: r.lastInsertRowid,
    login,
    message: `${name} criado (login: ${login} / senha: 123456)`,
  });
}));

router.post('/sellers/batch', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Lista vazia' });

  let count = 0;
  await db.transaction(async (client) => {
    for (const item of items) {
      const nm = item.name?.trim();
      if (!nm) continue;
      await client.query(
        'INSERT INTO sellers (name, store) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [nm, item.store || '']
      );
      const login = nm
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '.')
        .replace(/[^a-z0-9.]/g, '');
      const hash = bcrypt.hashSync('123456', 10);
      await client.query(
        'INSERT INTO users (name, login, password, role, store) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [nm, login, hash, 'vendedor', item.store || '']
      );
      count++;
    }
  });
  res.json({ message: `${count} vendedores importados (senha: 123456)` });
}));

router.delete('/sellers/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('UPDATE sellers SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removido' });
}));

// =====================================================================
// Catálogos com value
// =====================================================================
router.use('/planos',    crudRoutes('planos',    'Plano'));
router.use('/aparelhos', crudRoutes('aparelhos', 'Aparelho'));
router.use('/acessorios',crudRoutes('acessorios','Acessorio'));

// =====================================================================
// Serviços (sem value)
// =====================================================================
router.get('/servicos', auth, asyncHandler(async (req, res) => {
  res.json(await db.all('SELECT * FROM servicos WHERE active = 1 ORDER BY name'));
}));

router.post('/servicos', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  try {
    const r = await db.run('INSERT INTO servicos (name) VALUES ($1) RETURNING id', [name.trim()]);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ja existe' });
    throw e;
  }
}));

router.delete('/servicos/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('UPDATE servicos SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removido' });
}));

// =====================================================================
// Tipos (sem value)
// =====================================================================
router.get('/tipos', auth, asyncHandler(async (req, res) => {
  res.json(await db.all('SELECT * FROM tipos WHERE active = 1 ORDER BY name'));
}));

router.post('/tipos', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  try {
    const r = await db.run('INSERT INTO tipos (name) VALUES ($1) RETURNING id', [name.trim()]);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ja existe' });
    throw e;
  }
}));

router.delete('/tipos/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('UPDATE tipos SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removido' });
}));

module.exports = router;