const express = require('express');
const { db } = require('../database');
const { auth, roles, canSeeAll, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// =====================================================================
// Vendas Diárias
// =====================================================================

// GET /api/sales?month=2&year=2026
router.get('/', auth, asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.query;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });

  let rows;
  if (canSeeAll(req.user)) {
    rows = await db.all(
      'SELECT * FROM sales WHERE month = $1 AND year = $2',
      [+month, +year]
    );
  } else if (req.user.role === 'gerente') {
    const sellers = await db.all(
      'SELECT name FROM sellers WHERE store = $1 AND active = 1',
      [req.user.store]
    );
    if (!sellers.length) return res.json([]);
    const names = sellers.map(s => s.name);
    const placeholders = names.map((_, i) => `$${i + 3}`).join(',');
    rows = await db.all(
      `SELECT * FROM sales WHERE month = $1 AND year = $2 AND seller IN (${placeholders})`,
      [+month, +year, ...names]
    );
  } else {
    rows = await db.all(
      'SELECT * FROM sales WHERE month = $1 AND year = $2 AND seller = $3',
      [+month, +year, req.user.name]
    );
  }
  res.json(rows);
}));

// POST /api/sales
router.post('/', auth, asyncHandler(async (req, res) => {
  const { seller, day, month, year = 2026, value } = req.body;
  if (!seller || !day || month === undefined || !value) {
    return res.status(400).json({ error: 'Campos obrigatorios' });
  }

  const existing = await db.get(
    'SELECT id, value FROM sales WHERE seller = $1 AND day = $2 AND month = $3 AND year = $4',
    [seller, day, +month, +year]
  );

  if (existing) {
    const newVal = existing.value + value;
    await db.run('UPDATE sales SET value = $1 WHERE id = $2', [newVal, existing.id]);
    return res.json({ id: existing.id, value: newVal, message: 'Acumulado' });
  }

  const r = await db.run(
    'INSERT INTO sales (seller, day, month, year, value) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [seller, day, +month, +year, value]
  );
  res.status(201).json({ id: r.lastInsertRowid, message: 'Registrado' });
}));

// PUT /api/sales/:id
router.put('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Valor obrigatorio' });

  if (value <= 0) {
    await db.run('DELETE FROM sales WHERE id = $1', [req.params.id]);
    return res.json({ message: 'Zerado e removido' });
  }
  await db.run('UPDATE sales SET value = $1 WHERE id = $2', [value, req.params.id]);
  res.json({ message: 'Atualizado' });
}));

// DELETE /api/sales/:id
router.delete('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('DELETE FROM sales WHERE id = $1', [req.params.id]);
  res.json({ message: 'Excluido' });
}));

// =====================================================================
// Cancelamentos
// =====================================================================

// GET /api/sales/cancellations
router.get('/cancellations', auth, asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.query;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });

  const rows = canSeeAll(req.user)
    ? await db.all('SELECT * FROM cancellations WHERE month = $1 AND year = $2', [+month, +year])
    : await db.all(
        'SELECT * FROM cancellations WHERE month = $1 AND year = $2 AND seller = $3',
        [+month, +year, req.user.name]
      );
  res.json(rows);
}));

// POST /api/sales/cancellations
router.post('/cancellations', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { seller, day, month, year = 2026, value } = req.body;
  if (!seller || !day || month === undefined || !value) {
    return res.status(400).json({ error: 'Campos obrigatorios' });
  }

  const existing = await db.get(
    'SELECT id, value FROM cancellations WHERE seller = $1 AND day = $2 AND month = $3 AND year = $4',
    [seller, day, +month, +year]
  );

  if (existing) {
    await db.run('UPDATE cancellations SET value = $1 WHERE id = $2', [existing.value + value, existing.id]);
    return res.json({ id: existing.id, message: 'Acumulado' });
  }

  const r = await db.run(
    'INSERT INTO cancellations (seller, day, month, year, value) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [seller, day, +month, +year, value]
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// DELETE /api/sales/cancellations/:id
router.delete('/cancellations/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('DELETE FROM cancellations WHERE id = $1', [req.params.id]);
  res.json({ message: 'Excluido' });
}));

// =====================================================================
// Registros de Venda (Relatório completo)
// =====================================================================

// GET /api/sales/records
router.get('/records', auth, asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.query;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });

  let rows;
  if (canSeeAll(req.user)) {
    rows = await db.all(
      'SELECT * FROM sale_records WHERE month = $1 AND year = $2 ORDER BY day DESC',
      [+month, +year]
    );
  } else if (req.user.role === 'gerente') {
    rows = await db.all(
      'SELECT * FROM sale_records WHERE month = $1 AND year = $2 AND store = $3 ORDER BY day DESC',
      [+month, +year, req.user.store]
    );
  } else {
    rows = await db.all(
      'SELECT * FROM sale_records WHERE month = $1 AND year = $2 AND seller = $3 ORDER BY day DESC',
      [+month, +year, req.user.name]
    );
  }
  res.json(rows);
}));

// POST /api/sales/records
router.post('/records', auth, asyncHandler(async (req, res) => {
  const r = req.body;
  const result = await db.run(
    `INSERT INTO sale_records
      (month, day, date, seller, store, service, tipo, client_name, cpf, plan,
       value, aparelho, acessorio, access_number, bko, meta_cat, status, year)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      r.month, r.day, r.date || '', r.seller || '', r.store || '',
      r.service || '', r.tipo || '', r.clientName || '', r.cpf || '',
      r.plan || '', r.value || 0, r.aparelho || '', r.acessorio || '',
      r.accessNumber || '', r.bko || '', r.metaCat || '',
      r.status || 'OK', r.year || 2026,
    ]
  );
  res.status(201).json({ id: result.lastInsertRowid });
}));

// DELETE /api/sales/records/:id
router.delete('/records/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('DELETE FROM sale_records WHERE id = $1', [req.params.id]);
  res.json({ message: 'Excluido' });
}));

// =====================================================================
// Dashboard
// =====================================================================

// GET /api/sales/dashboard?month=&year=
router.get('/dashboard', auth, asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.query;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });
  const m = +month, y = +year;

  const [salesData, cancelData, metasData, catData] = await Promise.all([
    canSeeAll(req.user)
      ? db.all(
          'SELECT seller, day, SUM(value) AS value FROM sales WHERE month = $1 AND year = $2 GROUP BY seller, day',
          [m, y]
        )
      : db.all(
          'SELECT seller, day, SUM(value) AS value FROM sales WHERE month = $1 AND year = $2 AND seller = $3 GROUP BY seller, day',
          [m, y, req.user.name]
        ),

    canSeeAll(req.user)
      ? db.get('SELECT COALESCE(SUM(value),0) AS total FROM cancellations WHERE month = $1 AND year = $2', [m, y])
      : db.get('SELECT COALESCE(SUM(value),0) AS total FROM cancellations WHERE month = $1 AND year = $2 AND seller = $3', [m, y, req.user.name]),

    db.all('SELECT category, value FROM metas WHERE month = $1 AND year = $2', [m, y]),

    canSeeAll(req.user)
      ? db.all(
          `SELECT meta_cat, SUM(value) AS total FROM sale_records
           WHERE month = $1 AND year = $2 AND meta_cat != '' GROUP BY meta_cat`,
          [m, y]
        )
      : db.all(
          `SELECT meta_cat, SUM(value) AS total FROM sale_records
           WHERE month = $1 AND year = $2 AND seller = $3 AND meta_cat != '' GROUP BY meta_cat`,
          [m, y, req.user.name]
        ),
  ]);

  const metaTotal = metasData.reduce((s, r) => s + parseFloat(r.value), 0);

  res.json({
    sales:         salesData,
    cancellations: parseFloat(cancelData?.total || 0),
    metas:         Object.fromEntries(metasData.map(r => [r.category, parseFloat(r.value)])),
    metaTotal,
    categories:    Object.fromEntries(catData.map(c => [c.meta_cat, parseFloat(c.total)])),
  });
}));

module.exports = router;