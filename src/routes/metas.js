const express = require('express');
const { db } = require('../database');
const { auth, roles, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// GET /api/metas?year=2026
router.get('/', auth, asyncHandler(async (req, res) => {
  const { year = 2026 } = req.query;
  const rows = await db.all('SELECT * FROM metas WHERE year = $1', [+year]);

  // Organizar: { mes: { categoria: valor } }
  const result = {};
  rows.forEach(r => {
    if (!result[r.month]) result[r.month] = {};
    result[r.month][r.category] = parseFloat(r.value);
  });
  res.json(result);
}));

// POST /api/metas  (batch save)
// Body: { metas: { "2": { "Pos": 5000, "Controle": 3000 }, ... }, year: 2026 }
router.post('/', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { metas, year = 2026 } = req.body;
  if (!metas) return res.status(400).json({ error: 'Metas obrigatorias' });

  await db.transaction(async (client) => {
    for (const [month, cats] of Object.entries(metas)) {
      for (const [cat, val] of Object.entries(cats)) {
        await client.query(
          `INSERT INTO metas (month, category, value, year) VALUES ($1, $2, $3, $4)
           ON CONFLICT (month, category, year) DO UPDATE SET value = EXCLUDED.value`,
          [+month, cat, +val || 0, +year]
        );
      }
    }
  });

  res.json({ message: 'Metas salvas' });
}));

module.exports = router;