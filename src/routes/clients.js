const express = require('express');
const { db } = require('../database');
const { auth, roles, canSeeAll, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// =====================================================================
// Clientes
// =====================================================================

// GET /api/clients?store=&search=
router.get('/', auth, asyncHandler(async (req, res) => {
  const { store, search } = req.query;
  const params = [];
  let i = 1;
  let sql = 'SELECT * FROM clients WHERE active = 1';

  if (!canSeeAll(req.user)) {
    if (req.user.role === 'gerente') {
      sql += ` AND store = $${i++}`;
      params.push(req.user.store);
    } else {
      sql += ` AND seller = $${i++}`;
      params.push(req.user.name);
    }
  } else if (store) {
    sql += ` AND store = $${i++}`;
    params.push(store);
  }

  if (search) {
    sql += ` AND name ILIKE $${i++}`;
    params.push(`%${search}%`);
  }

  sql += ' ORDER BY name';
  const clients = await db.all(sql, params);

  // Anexar pagamentos de cada cliente
  const payStmt = 'SELECT month, year, status FROM payments WHERE client_id = $1 AND year = 2026';
  await Promise.all(clients.map(async (c) => {
    const pays = await db.all(payStmt, [c.id]);
    c.payments = {};
    pays.forEach(p => { c.payments[p.month] = p.status; });
  }));

  res.json(clients);
}));

// POST /api/clients
router.post('/', auth, asyncHandler(async (req, res) => {
  const c = req.body;
  if (!c.name) return res.status(400).json({ error: 'Nome obrigatorio' });

  const result = await db.run(
    `INSERT INTO clients
      (name, product, value, seller, store, due_day, tipo_pessoa, cpf, birth_date, sexo,
       cep, uf, city, rua, bairro, numero, email, phone, phone2)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      c.name, c.product || '', c.value || 0, c.seller || '', c.store || '',
      c.dueDay || 1, c.tipoPessoa || 'Pessoa Fisica', c.cpf || '',
      c.birthDate || '', c.sexo || '', c.cep || '', c.uf || '',
      c.city || '', c.rua || '', c.bairro || '', c.numero || '',
      c.email || '', c.phone || '', c.phone2 || '',
    ]
  );
  res.status(201).json({ id: result.lastInsertRowid, message: 'Cliente cadastrado' });
}));

// PUT /api/clients/:id
router.put('/:id', auth, asyncHandler(async (req, res) => {
  const c = req.body;
  const existing = await db.get('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Nao encontrado' });

  await db.run(
    `UPDATE clients SET
      name=$1, product=$2, value=$3, seller=$4, store=$5, due_day=$6,
      tipo_pessoa=$7, cpf=$8, birth_date=$9, sexo=$10,
      cep=$11, uf=$12, city=$13, rua=$14, bairro=$15, numero=$16,
      email=$17, phone=$18, phone2=$19
     WHERE id = $20`,
    [
      c.name, c.product || '', c.value || 0, c.seller || '', c.store || '',
      c.dueDay || 1, c.tipoPessoa || '', c.cpf || '',
      c.birthDate || '', c.sexo || '', c.cep || '', c.uf || '',
      c.city || '', c.rua || '', c.bairro || '', c.numero || '',
      c.email || '', c.phone || '', c.phone2 || '', req.params.id,
    ]
  );
  res.json({ message: 'Atualizado' });
}));

// DELETE /api/clients/:id
router.delete('/:id', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  await db.run('UPDATE clients SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removido' });
}));

// =====================================================================
// Pagamentos
// =====================================================================

// POST /api/clients/:id/pay
router.post('/:id/pay', auth, asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.body;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });

  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Cliente nao encontrado' });

  try {
    await db.run(
      'INSERT INTO payments (client_id, month, year) VALUES ($1, $2, $3)',
      [req.params.id, +month, +year]
    );
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ja pago' });
    throw e;
  }

  // Registrar no diário de vendas
  const daysInMonth = new Date(+year, +month + 1, 0).getDate();
  const day = Math.min(client.due_day || 1, daysInMonth);

  const existingSale = await db.get(
    'SELECT id, value FROM sales WHERE seller = $1 AND day = $2 AND month = $3 AND year = $4',
    [client.seller, day, +month, +year]
  );

  if (existingSale) {
    await db.run('UPDATE sales SET value = $1 WHERE id = $2', [existingSale.value + client.value, existingSale.id]);
  } else {
    await db.run(
      'INSERT INTO sales (seller, day, month, year, value) VALUES ($1, $2, $3, $4, $5)',
      [client.seller, day, +month, +year, client.value]
    );
  }

  res.json({ message: `Pagamento confirmado - ${client.name}` });
}));

// DELETE /api/clients/:id/pay
router.delete('/:id/pay', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { month, year = 2026 } = req.body;
  if (month === undefined) return res.status(400).json({ error: 'month obrigatorio' });

  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Nao encontrado' });

  await db.run(
    'DELETE FROM payments WHERE client_id = $1 AND month = $2 AND year = $3',
    [req.params.id, +month, +year]
  );

  // Remover do diário de vendas
  const daysInMonth = new Date(+year, +month + 1, 0).getDate();
  const day = Math.min(client.due_day || 1, daysInMonth);

  const sale = await db.get(
    'SELECT id, value FROM sales WHERE seller = $1 AND day = $2 AND month = $3 AND year = $4',
    [client.seller, day, +month, +year]
  );

  if (sale) {
    const newVal = sale.value - client.value;
    if (newVal <= 0) {
      await db.run('DELETE FROM sales WHERE id = $1', [sale.id]);
    } else {
      await db.run('UPDATE sales SET value = $1 WHERE id = $2', [newVal, sale.id]);
    }
  }

  res.json({ message: 'Pagamento desfeito' });
}));

module.exports = router;