require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// =====================================================================
// Singleton pool — reutilizado entre invocações quentes no Vercel
// =====================================================================
let _pool = null;

function getPool() {
  if (_pool) return _pool;

  _pool = new Pool({
    host:     process.env.DB_HOST || '38.52.128.131',
    port:     parseInt(process.env.DB_PORT || '5433'),
    database: process.env.DB_NAME || 'msconnect',
    user:     process.env.DB_USER || 'vai',
    password: process.env.DB_PASS || 'Vai_2025', 
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max:      10,
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 5000,
  });

  _pool.on('error', (err) => console.error('[DB] Pool error:', err.message));
  return _pool;
}

// =====================================================================
// Helpers de consulta (interface parecida com better-sqlite3, mas async)
// =====================================================================
const db = {
  /** Retorna única linha ou null */
  async get(sql, params = []) {
    const res = await getPool().query(sql, params);
    return res.rows[0] || null;
  },

  /** Retorna todas as linhas */
  async all(sql, params = []) {
    const res = await getPool().query(sql, params);
    return res.rows;
  },

  /**
   * Executa INSERT/UPDATE/DELETE.
   * Para INSERT, adicione RETURNING id na query para obter lastInsertRowid.
   */
  async run(sql, params = []) {
    const res = await getPool().query(sql, params);
    return {
      lastInsertRowid: res.rows[0]?.id || null,
      changes: res.rowCount,
    };
  },

  /** Executa bloco em transação; recebe (client) => resultado */
  async transaction(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  getPool,
};

// =====================================================================
// Inicialização do schema (idempotente)
// =====================================================================
let _initialized = false;

async function initDb() {
  if (_initialized) return;

  const client = await getPool().connect();
  try {
    // ---------- Tabelas ----------
    const DDL = [
      `CREATE TABLE IF NOT EXISTS users (
         id          SERIAL PRIMARY KEY,
         name        TEXT NOT NULL,
         login       TEXT NOT NULL UNIQUE,
         password    TEXT NOT NULL,
         role        TEXT NOT NULL DEFAULT 'vendedor'
                       CHECK(role IN ('admin','diretor','analista','gerente','vendedor')),
         store       TEXT DEFAULT '',
         active      INTEGER DEFAULT 1,
         created_at  TIMESTAMPTZ DEFAULT NOW(),
         updated_at  TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS stores (
         id         SERIAL PRIMARY KEY,
         name       TEXT NOT NULL UNIQUE,
         active     INTEGER DEFAULT 1,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS sellers (
         id         SERIAL PRIMARY KEY,
         name       TEXT NOT NULL,
         store      TEXT DEFAULT '',
         user_id    INTEGER REFERENCES users(id),
         active     INTEGER DEFAULT 1,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS planos (
         id     SERIAL PRIMARY KEY,
         name   TEXT NOT NULL,
         value  REAL DEFAULT 0,
         obs    TEXT DEFAULT '',
         active INTEGER DEFAULT 1
       )`,

      `CREATE TABLE IF NOT EXISTS aparelhos (
         id     SERIAL PRIMARY KEY,
         name   TEXT NOT NULL,
         value  REAL DEFAULT 0,
         obs    TEXT DEFAULT '',
         active INTEGER DEFAULT 1
       )`,

      `CREATE TABLE IF NOT EXISTS acessorios (
         id     SERIAL PRIMARY KEY,
         name   TEXT NOT NULL,
         value  REAL DEFAULT 0,
         obs    TEXT DEFAULT '',
         active INTEGER DEFAULT 1
       )`,

      `CREATE TABLE IF NOT EXISTS servicos (
         id     SERIAL PRIMARY KEY,
         name   TEXT NOT NULL UNIQUE,
         active INTEGER DEFAULT 1
       )`,

      `CREATE TABLE IF NOT EXISTS tipos (
         id     SERIAL PRIMARY KEY,
         name   TEXT NOT NULL UNIQUE,
         active INTEGER DEFAULT 1
       )`,

      `CREATE TABLE IF NOT EXISTS sales (
         id         SERIAL PRIMARY KEY,
         seller     TEXT NOT NULL,
         day        INTEGER NOT NULL,
         month      INTEGER NOT NULL,
         year       INTEGER DEFAULT 2026,
         value      REAL NOT NULL,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS cancellations (
         id         SERIAL PRIMARY KEY,
         seller     TEXT NOT NULL,
         day        INTEGER NOT NULL,
         month      INTEGER NOT NULL,
         year       INTEGER DEFAULT 2026,
         value      REAL NOT NULL,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS sale_records (
         id            SERIAL PRIMARY KEY,
         month         INTEGER NOT NULL,
         day           INTEGER NOT NULL,
         date          TEXT,
         seller        TEXT,
         store         TEXT,
         service       TEXT,
         tipo          TEXT,
         client_name   TEXT,
         cpf           TEXT,
         plan          TEXT,
         value         REAL DEFAULT 0,
         aparelho      TEXT,
         acessorio     TEXT,
         access_number TEXT,
         bko           TEXT,
         meta_cat      TEXT,
         status        TEXT DEFAULT 'OK',
         year          INTEGER DEFAULT 2026,
         created_at    TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS clients (
         id          SERIAL PRIMARY KEY,
         name        TEXT NOT NULL,
         product     TEXT DEFAULT '',
         value       REAL DEFAULT 0,
         seller      TEXT DEFAULT '',
         store       TEXT DEFAULT '',
         due_day     INTEGER DEFAULT 1,
         tipo_pessoa TEXT DEFAULT 'Pessoa Fisica',
         cpf         TEXT DEFAULT '',
         birth_date  TEXT,
         sexo        TEXT DEFAULT '',
         cep         TEXT DEFAULT '',
         uf          TEXT DEFAULT '',
         city        TEXT DEFAULT '',
         rua         TEXT DEFAULT '',
         bairro      TEXT DEFAULT '',
         numero      TEXT DEFAULT '',
         email       TEXT DEFAULT '',
         phone       TEXT DEFAULT '',
         phone2      TEXT DEFAULT '',
         active      INTEGER DEFAULT 1,
         created_at  TIMESTAMPTZ DEFAULT NOW()
       )`,

      `CREATE TABLE IF NOT EXISTS payments (
         id        SERIAL PRIMARY KEY,
         client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
         month     INTEGER NOT NULL,
         year      INTEGER DEFAULT 2026,
         status    TEXT DEFAULT 'paid',
         paid_at   TIMESTAMPTZ DEFAULT NOW(),
         UNIQUE(client_id, month, year)
       )`,

      `CREATE TABLE IF NOT EXISTS metas (
         id       SERIAL PRIMARY KEY,
         month    INTEGER NOT NULL,
         category TEXT NOT NULL,
         value    REAL DEFAULT 0,
         year     INTEGER DEFAULT 2026,
         UNIQUE(month, category, year)
       )`,

      `CREATE TABLE IF NOT EXISTS wa_config (
         id             INTEGER PRIMARY KEY DEFAULT 1,
         numbers        TEXT DEFAULT '[]',
         report_items   TEXT DEFAULT '{}',
         horario        TEXT DEFAULT '18:00',
         ativo          INTEGER DEFAULT 0,
         api_endpoint   TEXT DEFAULT '',
         formato        TEXT DEFAULT 'texto'
       )`,

      `CREATE TABLE IF NOT EXISTS wa_logs (
         id         SERIAL PRIMARY KEY,
         date       TEXT,
         time       TEXT,
         numbers    TEXT,
         status     TEXT DEFAULT 'ok',
         message    TEXT,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`,

      // Indices
      `CREATE INDEX IF NOT EXISTS idx_sales_month    ON sales(month, year)`,
      `CREATE INDEX IF NOT EXISTS idx_sales_seller   ON sales(seller)`,
      `CREATE INDEX IF NOT EXISTS idx_cancel_month   ON cancellations(month, year)`,
      `CREATE INDEX IF NOT EXISTS idx_records_month  ON sale_records(month, year)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_store  ON clients(store)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id, year)`,
    ];

    await client.query('BEGIN');
    for (const sql of DDL) {
      await client.query(sql);
    }
    await client.query('COMMIT');

    // ---------- Seeds ----------

    // Admin
    const admin = await db.get(
      'SELECT id FROM users WHERE login = $1',
      [process.env.ADMIN_LOGIN || 'admin']
    );
    if (!admin) {
      const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin', 10);
      await db.run(
        'INSERT INTO users (name, login, password, role) VALUES ($1, $2, $3, $4)',
        [process.env.ADMIN_NAME || 'Administrador', process.env.ADMIN_LOGIN || 'admin', hash, 'admin']
      );
      console.log('[DB] Admin criado');
    }

    // Servicos padrão
    const svcRow = await db.get('SELECT COUNT(*)::int AS cnt FROM servicos');
    if ((svcRow?.cnt || 0) === 0) {
      for (const s of ['Pos', 'Controle', 'Pre', 'Fixa', 'Vivo Empresas']) {
        await db.run('INSERT INTO servicos (name) VALUES ($1) ON CONFLICT DO NOTHING', [s]);
      }
    }

    // Tipos padrão
    const tipoRow = await db.get('SELECT COUNT(*)::int AS cnt FROM tipos');
    if ((tipoRow?.cnt || 0) === 0) {
      const tipos = [
        'Alta', 'Reativacao', 'Troca de Plano', 'Troca de Simcard',
        'Migracao', 'Seguro', 'SVA', 'Troca de titularidade', 'Troca de numero',
      ];
      for (const t of tipos) {
        await db.run('INSERT INTO tipos (name) VALUES ($1) ON CONFLICT DO NOTHING', [t]);
      }
    }

    // wa_config (singleton linha id=1)
    await db.run('INSERT INTO wa_config (id) VALUES (1) ON CONFLICT DO NOTHING');

    _initialized = true;
    console.log('[DB] Banco inicializado');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    _initialized = false; // permite nova tentativa
    console.error('[DB] Erro na inicializacao:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { db, initDb };