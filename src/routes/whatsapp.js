const express = require('express');
const axios = require('axios');
const { db } = require('../database');
const { auth, roles, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// =====================================================================
// Configuração
// =====================================================================

// GET /api/whatsapp/config
router.get('/config', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const config = await db.get('SELECT * FROM wa_config WHERE id = 1');
  config.numbers      = JSON.parse(config.numbers      || '[]');
  config.report_items = JSON.parse(config.report_items || '{}');
  res.json(config);
}));

// PUT /api/whatsapp/config
router.put('/config', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { numbers, report_items, horario, ativo, api_endpoint, formato, wa_token, wa_id } = req.body;
  const sets = [];
  const params = [];
  let i = 1;

  if (numbers      !== undefined) { sets.push(`numbers = $${i++}`);      params.push(JSON.stringify(numbers)); }
  if (report_items !== undefined) { sets.push(`report_items = $${i++}`); params.push(JSON.stringify(report_items)); }
  if (horario      !== undefined) { sets.push(`horario = $${i++}`);      params.push(horario); }
  if (ativo        !== undefined) { sets.push(`ativo = $${i++}`);        params.push(ativo ? 1 : 0); }
  if (api_endpoint !== undefined) { sets.push(`api_endpoint = $${i++}`); params.push(api_endpoint); }
  if (formato      !== undefined) { sets.push(`formato = $${i++}`);      params.push(formato); }
  if (wa_token     !== undefined) { sets.push(`wa_token = $${i++}`);     params.push(wa_token); }
  if (wa_id        !== undefined) { sets.push(`wa_id = $${i++}`);        params.push(wa_id); }

  if (sets.length > 0) {
    params.push(1); // WHERE id = 1
    await db.run(`UPDATE wa_config SET ${sets.join(', ')} WHERE id = $${i}`, params);
  }
  res.json({ message: 'Configuracao salva' });
}));

// POST /api/whatsapp/config/numbers
router.post('/config/numbers', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Numero obrigatorio' });

  const clean = number.replace(/\D/g, '');
  if (clean.length < 10) return res.status(400).json({ error: 'Numero invalido' });

  const config = await db.get('SELECT numbers FROM wa_config WHERE id = 1');
  const nums = JSON.parse(config.numbers || '[]');
  if (nums.includes(clean)) return res.status(409).json({ error: 'Ja cadastrado' });

  nums.push(clean);
  await db.run('UPDATE wa_config SET numbers = $1 WHERE id = 1', [JSON.stringify(nums)]);
  res.json({ message: 'Numero adicionado', numbers: nums });
}));

// DELETE /api/whatsapp/config/numbers/:index
router.delete('/config/numbers/:index', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const config = await db.get('SELECT numbers FROM wa_config WHERE id = 1');
  const nums = JSON.parse(config.numbers || '[]');
  nums.splice(+req.params.index, 1);
  await db.run('UPDATE wa_config SET numbers = $1 WHERE id = 1', [JSON.stringify(nums)]);
  res.json({ message: 'Removido', numbers: nums });
}));

// =====================================================================
// Envio do relatório
// =====================================================================

// POST /api/whatsapp/send
const WA_API_URL = 'https://backend-chat.vaidavenda.com.br/api/v1/messages';

router.post('/send', auth, roles('admin', 'analista', 'diretor'), asyncHandler(async (req, res) => {
  const config = await db.get('SELECT * FROM wa_config WHERE id = 1');
  const numbers     = JSON.parse(config.numbers      || '[]');
  const reportItems = JSON.parse(config.report_items || '{}');
  const waToken     = config.wa_token || '';
  const waId        = config.wa_id    || '';

  if (!numbers.length) return res.status(400).json({ error: 'Nenhum numero cadastrado' });
  if (!waToken)        return res.status(400).json({ error: 'Token nao configurado' });
  if (!waId)           return res.status(400).json({ error: 'ID nao configurado' });

  const month = req.body.month !== undefined ? +req.body.month : new Date().getMonth();
  const year  = req.body.year  || 2026;
  const MO    = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const [sellers, salesData, cancelRow, metaRow] = await Promise.all([
    db.all('SELECT name FROM sellers WHERE active = 1'),
    db.all(
      'SELECT seller, SUM(value) AS total FROM sales WHERE month = $1 AND year = $2 GROUP BY seller ORDER BY total DESC',
      [month, year]
    ),
    db.get('SELECT COALESCE(SUM(value),0) AS total FROM cancellations WHERE month = $1 AND year = $2', [month, year]),
    db.get('SELECT COALESCE(SUM(value),0) AS total FROM metas WHERE month = $1 AND year = $2', [month, year]),
  ]);

  const cancelTotal  = parseFloat(cancelRow?.total  || 0);
  const metaTotal    = parseFloat(metaRow?.total    || 0);
  const totalVendas  = salesData.reduce((s, r) => s + parseFloat(r.total), 0);
  const atingimento  = metaTotal > 0 ? ((totalVendas / metaTotal) * 100).toFixed(1) : '0';

  let msg = `*RELATORIO MS CONNECT - ${MO[month]} ${year}*\n`;
  msg += `${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}\n\n`;

  if (reportItems.totalColab)   msg += `Colaboradores ativos: ${sellers.length}\n`;
  if (reportItems.producaoTotal) {
    msg += `Producao: R$ ${totalVendas.toLocaleString('pt-BR')}\n`;
    msg += `Meta: R$ ${metaTotal.toLocaleString('pt-BR')} | ${atingimento}%\n`;
  }
  if (reportItems.improdutivos) {
    const produtivos = new Set(salesData.map(s => s.seller));
    const improd = sellers.filter(s => !produtivos.has(s.name));
    msg += `Improdutivos: ${improd.length}`;
    if (improd.length) msg += ` (${improd.map(s => s.name).join(', ')})`;
    msg += '\n';
  }
  if (reportItems.ocorrencias)  msg += `Cancelamentos: R$ ${cancelTotal.toLocaleString('pt-BR')}\n`;
  if (reportItems.rankProd && salesData.length) {
    msg += `\n*Top 5 Produtividade:*\n`;
    salesData.slice(0, 5).forEach((r, i) => {
      msg += `${i + 1}. ${r.seller}: R$ ${parseFloat(r.total).toLocaleString('pt-BR')}\n`;
    });
  }
  if (reportItems.rankImprod && salesData.length) {
    msg += `\n*Menor Produtividade:*\n`;
    [...salesData].reverse().slice(0, 5).forEach((r, i) => {
      msg += `${i + 1}. ${r.seller}: R$ ${parseFloat(r.total).toLocaleString('pt-BR')}\n`;
    });
  }
  if (reportItems.abaixoMeta) {
    const metaPP = metaTotal / Math.max(sellers.length, 1);
    const abaixo = salesData.filter(s => parseFloat(s.total) < metaPP);
    msg += `\nAbaixo da meta: ${abaixo.length} colaboradores\n`;
  }

  const logData = {
    date:    new Date().toLocaleDateString('pt-BR'),
    time:    new Date().toLocaleTimeString('pt-BR'),
    numbers: numbers.join(', '),
    message: msg.substring(0, 200),
  };

  try {
    await axios.post(WA_API_URL, {
      whatsappId: waId,
      messages: numbers.map(n => ({
        number: n,
        name:   n,
        body:   msg,
      })),
    }, {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${waToken}`,
      },
      timeout: 15000,
    });

    await db.run(
      'INSERT INTO wa_logs (date, time, numbers, status, message) VALUES ($1,$2,$3,$4,$5)',
      [logData.date, logData.time, logData.numbers, 'ok', logData.message]
    );
    res.json({ message: 'Relatorio enviado', log: { ...logData, status: 'ok' } });
  } catch (e) {
    const apiStatus  = e.response?.status  || null;
    const apiBody    = e.response?.data    || null;
    const errDetail  = apiBody ? JSON.stringify(apiBody) : e.message;

    console.error('[WA SEND] status:', apiStatus, '| body:', JSON.stringify(apiBody));
    console.error('[WA SEND] payload enviado:', JSON.stringify({ numbers, id: waId, format: config.formato }));

    await db.run(
      'INSERT INTO wa_logs (date, time, numbers, status, message) VALUES ($1,$2,$3,$4,$5)',
      [logData.date, logData.time, logData.numbers, 'erro', errDetail.substring(0, 200)]
    );
    res.status(500).json({
      error:      'Falha no envio: ' + e.message,
      api_status: apiStatus,
      api_body:   apiBody,
    });
  }
}));

// =====================================================================
// Logs
// =====================================================================

// GET /api/whatsapp/logs
router.get('/logs', auth, roles('admin', 'analista'), asyncHandler(async (req, res) => {
  const logs = await db.all('SELECT * FROM wa_logs ORDER BY id DESC LIMIT 50');
  res.json(logs);
}));

// DELETE /api/whatsapp/logs
router.delete('/logs', auth, roles('admin'), asyncHandler(async (req, res) => {
  await db.run('DELETE FROM wa_logs');
  res.json({ message: 'Logs limpos' });
}));

module.exports = router;
