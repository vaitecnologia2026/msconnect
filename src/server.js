require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const rateLimit = require('express-rate-limit');
const path     = require('path');

const { initDb, db } = require('./database');
const axios = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

// =====================================================================
// Middlewares globais
// =====================================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));

const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map(s => s.trim());
app.use(cors({ origin: origins, credentials: true }));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT || '100'),
  message:  { error: 'Muitas requisicoes. Tente novamente.' },
}));

// =====================================================================
// Inicialização do banco (idempotente — segura em serverless)
// =====================================================================
let dbReady = false;
app.use(async (req, res, next) => {
  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (e) {
      console.error('[INIT] Falha ao inicializar banco:', e.message);
      return res.status(503).json({ error: 'Servico indisponivel. Tente novamente.' });
    }
  }
  next();
});

// =====================================================================
// Rotas API
// =====================================================================
const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/users');
const catalogRoutes   = require('./routes/catalog');
const salesRoutes     = require('./routes/sales');
const clientRoutes    = require('./routes/clients');
const metasRouter     = require('./routes/metas');
const whatsappRouter  = require('./routes/whatsapp');

app.use('/api/auth',      authRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/catalog',   catalogRoutes);
app.use('/api/sales',     salesRoutes);
app.use('/api/clients',   clientRoutes);
app.use('/api/metas',     metasRouter);
app.use('/api/whatsapp',  whatsappRouter);

// =====================================================================
// Cron endpoint  (chamado pelo Vercel Cron — ver vercel.json)
// Em produção local use node-cron ou um agendador externo.
// =====================================================================
app.get('/api/cron', async (req, res) => {
  // Proteção simples: só aceita chamada interna do Vercel
  const cronSecret = req.headers['x-vercel-cron-signature'] || req.query.secret;
  // Se quiser adicionar um CRON_SECRET nas env vars do Vercel, descomente:
  // if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  try {
    const config = await db.get('SELECT * FROM wa_config WHERE id = 1');
    if (!config || !config.ativo) return res.json({ skipped: 'cron desativado' });

    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (currentTime !== config.horario) return res.json({ skipped: `horario nao bateu (${currentTime} != ${config.horario})` });

    const today = now.toLocaleDateString('pt-BR');
    const alreadySent = await db.get("SELECT id FROM wa_logs WHERE date = $1 AND status = 'ok'", [today]);
    if (alreadySent) return res.json({ skipped: 'ja enviado hoje' });

    // Disparar /api/whatsapp/send
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${PORT}`;

    const token = require('jsonwebtoken').sign(
      { id: 0, login: 'cron', role: 'admin', name: 'cron', store: '' },
      process.env.JWT_SECRET || 'msconnect_default_secret',
      { expiresIn: '5m' }
    );

    await axios.post(
      `${baseUrl}/api/whatsapp/send`,
      { month: now.getMonth() },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
    );

    res.json({ ok: true, sent: today });
  } catch (e) {
    console.error('[CRON] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// Health check
// =====================================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0-pg' });
});

// =====================================================================
// Servir frontend (em desenvolvimento local; Vercel usa @vercel/static)
// =====================================================================
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

// =====================================================================
// Error handler global
// =====================================================================
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// =====================================================================
// Start (apenas em desenvolvimento local)
// Em Vercel, o módulo é importado diretamente — sem app.listen()
// =====================================================================
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║   MS Connect — Backend API (PostgreSQL)  ║
  ║   #vivolojas                             ║
  ╠══════════════════════════════════════════╣
  ║   Porta : ${PORT}                            ║
  ║   API   : http://localhost:${PORT}/api       ║
  ║   Health: http://localhost:${PORT}/api/health║
  ╚══════════════════════════════════════════╝
    `);
  });
}

// Vercel importa este módulo e usa o app como handler
module.exports = app;