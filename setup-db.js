/**
 * setup-db.js
 * Executa uma unica vez para criar todas as tabelas e seeds no PostgreSQL.
 * Uso: node setup-db.js
 *
 * Variaveis de ambiente necessarias (ou edite os defaults abaixo):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, DB_SSL
 *   ADMIN_LOGIN, ADMIN_PASSWORD, ADMIN_NAME
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

// ─── Conexão ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || '38.52.128.131',
  port:     parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'msconnect',
  user:     process.env.DB_USER || 'vai',
  password: process.env.DB_PASS || 'Vai_2025',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8000,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok  = (msg) => console.log(`  ✔  ${msg}`);
const err = (msg) => console.error(`  ✘  ${msg}`);

async function run(client, sql, label) {
  try {
    await client.query(sql);
    ok(label);
  } catch (e) {
    err(`${label} → ${e.message}`);
    throw e;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function setup() {
  console.log('\n══════════════════════════════════════════');
  console.log('  MS Connect — Setup do Banco de Dados');
  console.log(`  Host : ${process.env.DB_HOST || '38.52.128.131'}:${process.env.DB_PORT || '5433'}`);
  console.log(`  Banco: ${process.env.DB_NAME || '(DB_NAME nao definido)'}`);
  console.log('══════════════════════════════════════════\n');

  if (!process.env.DB_NAME || !process.env.DB_PASS) {
    err('DB_NAME e DB_PASS sao obrigatorios. Configure o .env e tente novamente.');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── Tabelas ──────────────────────────────────────────────────────────────

    await run(client, `
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL,
        login      TEXT    NOT NULL UNIQUE,
        password   TEXT    NOT NULL,
        role       TEXT    NOT NULL DEFAULT 'vendedor'
                     CHECK(role IN ('admin','diretor','analista','gerente','vendedor')),
        store      TEXT    DEFAULT '',
        active     INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: users');

    await run(client, `
      CREATE TABLE IF NOT EXISTS stores (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE,
        active     INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: stores');

    await run(client, `
      CREATE TABLE IF NOT EXISTS sellers (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL,
        store      TEXT    DEFAULT '',
        user_id    INTEGER REFERENCES users(id),
        active     INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: sellers');

    await run(client, `
      CREATE TABLE IF NOT EXISTS planos (
        id     SERIAL PRIMARY KEY,
        name   TEXT    NOT NULL,
        value  REAL    DEFAULT 0,
        obs    TEXT    DEFAULT '',
        active INTEGER DEFAULT 1
      )
    `, 'Tabela: planos');

    await run(client, `
      CREATE TABLE IF NOT EXISTS aparelhos (
        id     SERIAL PRIMARY KEY,
        name   TEXT    NOT NULL,
        value  REAL    DEFAULT 0,
        obs    TEXT    DEFAULT '',
        active INTEGER DEFAULT 1
      )
    `, 'Tabela: aparelhos');

    await run(client, `
      CREATE TABLE IF NOT EXISTS acessorios (
        id     SERIAL PRIMARY KEY,
        name   TEXT    NOT NULL,
        value  REAL    DEFAULT 0,
        obs    TEXT    DEFAULT '',
        active INTEGER DEFAULT 1
      )
    `, 'Tabela: acessorios');

    await run(client, `
      CREATE TABLE IF NOT EXISTS servicos (
        id     SERIAL PRIMARY KEY,
        name   TEXT    NOT NULL UNIQUE,
        active INTEGER DEFAULT 1
      )
    `, 'Tabela: servicos');

    await run(client, `
      CREATE TABLE IF NOT EXISTS tipos (
        id     SERIAL PRIMARY KEY,
        name   TEXT    NOT NULL UNIQUE,
        active INTEGER DEFAULT 1
      )
    `, 'Tabela: tipos');

    await run(client, `
      CREATE TABLE IF NOT EXISTS sales (
        id         SERIAL PRIMARY KEY,
        seller     TEXT    NOT NULL,
        day        INTEGER NOT NULL,
        month      INTEGER NOT NULL,
        year       INTEGER DEFAULT 2026,
        value      REAL    NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: sales');

    await run(client, `
      CREATE TABLE IF NOT EXISTS cancellations (
        id         SERIAL PRIMARY KEY,
        seller     TEXT    NOT NULL,
        day        INTEGER NOT NULL,
        month      INTEGER NOT NULL,
        year       INTEGER DEFAULT 2026,
        value      REAL    NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: cancellations');

    await run(client, `
      CREATE TABLE IF NOT EXISTS sale_records (
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
        value         REAL    DEFAULT 0,
        aparelho      TEXT,
        acessorio     TEXT,
        access_number TEXT,
        bko           TEXT,
        meta_cat      TEXT,
        status        TEXT    DEFAULT 'OK',
        year          INTEGER DEFAULT 2026,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: sale_records');

    await run(client, `
      CREATE TABLE IF NOT EXISTS clients (
        id          SERIAL PRIMARY KEY,
        name        TEXT    NOT NULL,
        product     TEXT    DEFAULT '',
        value       REAL    DEFAULT 0,
        seller      TEXT    DEFAULT '',
        store       TEXT    DEFAULT '',
        due_day     INTEGER DEFAULT 1,
        tipo_pessoa TEXT    DEFAULT 'Pessoa Fisica',
        cpf         TEXT    DEFAULT '',
        birth_date  TEXT,
        sexo        TEXT    DEFAULT '',
        cep         TEXT    DEFAULT '',
        uf          TEXT    DEFAULT '',
        city        TEXT    DEFAULT '',
        rua         TEXT    DEFAULT '',
        bairro      TEXT    DEFAULT '',
        numero      TEXT    DEFAULT '',
        email       TEXT    DEFAULT '',
        phone       TEXT    DEFAULT '',
        phone2      TEXT    DEFAULT '',
        active      INTEGER DEFAULT 1,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: clients');

    await run(client, `
      CREATE TABLE IF NOT EXISTS payments (
        id        SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        month     INTEGER NOT NULL,
        year      INTEGER DEFAULT 2026,
        status    TEXT    DEFAULT 'paid',
        paid_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(client_id, month, year)
      )
    `, 'Tabela: payments');

    await run(client, `
      CREATE TABLE IF NOT EXISTS metas (
        id       SERIAL PRIMARY KEY,
        month    INTEGER NOT NULL,
        category TEXT    NOT NULL,
        value    REAL    DEFAULT 0,
        year     INTEGER DEFAULT 2026,
        UNIQUE(month, category, year)
      )
    `, 'Tabela: metas');

    await run(client, `
      CREATE TABLE IF NOT EXISTS wa_config (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        numbers      TEXT DEFAULT '[]',
        report_items TEXT DEFAULT '{}',
        horario      TEXT DEFAULT '18:00',
        ativo        INTEGER DEFAULT 0,
        api_endpoint TEXT DEFAULT '',
        formato      TEXT DEFAULT 'texto'
      )
    `, 'Tabela: wa_config');

    await run(client, `
      CREATE TABLE IF NOT EXISTS wa_logs (
        id         SERIAL PRIMARY KEY,
        date       TEXT,
        time       TEXT,
        numbers    TEXT,
        status     TEXT DEFAULT 'ok',
        message    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'Tabela: wa_logs');

    // ─── Índices ──────────────────────────────────────────────────────────────

    await run(client, `CREATE INDEX IF NOT EXISTS idx_sales_month     ON sales(month, year)`,         'Index: sales(month,year)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_sales_seller    ON sales(seller)`,              'Index: sales(seller)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_cancel_month    ON cancellations(month, year)`, 'Index: cancellations(month,year)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_records_month   ON sale_records(month, year)`,  'Index: sale_records(month,year)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_records_seller  ON sale_records(seller)`,       'Index: sale_records(seller)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_clients_store   ON clients(store)`,             'Index: clients(store)');
    await run(client, `CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id, year)`,  'Index: payments(client_id,year)');

    await client.query('COMMIT');
    console.log('\n  Tabelas e indices criados com sucesso.\n');

    // ─── Seeds (idempotentes — ON CONFLICT DO NOTHING) ────────────────────────

    console.log('  Aplicando seeds...\n');

    // Admin
    const adminLogin = process.env.ADMIN_LOGIN    || 'admin';
    const adminPass  = process.env.ADMIN_PASSWORD || 'admin';
    const adminName  = process.env.ADMIN_NAME     || 'Administrador';

    const adminExists = await pool.query('SELECT id FROM users WHERE login = $1', [adminLogin]);
    if (adminExists.rows.length === 0) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await pool.query(
        'INSERT INTO users (name, login, password, role) VALUES ($1, $2, $3, $4)',
        [adminName, adminLogin, hash, 'admin']
      );
      ok(`Admin criado  →  login: "${adminLogin}"  /  senha: "${adminPass}"`);
    } else {
      ok(`Admin "${adminLogin}" ja existe — pulado`);
    }

    // Serviços padrão
    const servicos = ['Pos', 'Controle', 'Pre', 'Fixa', 'Vivo Empresas'];
    for (const s of servicos) {
      await pool.query('INSERT INTO servicos (name) VALUES ($1) ON CONFLICT DO NOTHING', [s]);
    }
    ok(`Servicos: ${servicos.join(', ')}`);

    // Tipos padrão
    const tipos = [
      'Alta', 'Reativacao', 'Troca de Plano', 'Troca de Simcard',
      'Migracao', 'Seguro', 'SVA', 'Troca de titularidade', 'Troca de numero',
    ];
    for (const t of tipos) {
      await pool.query('INSERT INTO tipos (name) VALUES ($1) ON CONFLICT DO NOTHING', [t]);
    }
    ok(`Tipos: ${tipos.join(', ')}`);

    // wa_config singleton
    await pool.query('INSERT INTO wa_config (id) VALUES (1) ON CONFLICT DO NOTHING');
    ok('wa_config inicializado (id=1)');

    console.log('\n══════════════════════════════════════════');
    console.log('  Setup concluido! Banco pronto para uso.');
    console.log('══════════════════════════════════════════\n');

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    err(`Setup falhou: ${e.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();