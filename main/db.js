const Database = require("better-sqlite3");
const path = require("path");
const { app } = require("electron");

let db;

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col) => col.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function initDB() {
  const dbPath = path.join(app.getPath("userData"), "database.db");
  db = new Database(dbPath);

  db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    username TEXT,
    password TEXT
  );

  CREATE TABLE IF NOT EXISTS port_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    local_socks_port INTEGER
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    optional_port INTEGER,
    credential_id INTEGER,
    port_profile_id INTEGER,
    best_port INTEGER,
    socks_port INTEGER,
    country_code TEXT,
    country_flag TEXT,
    is_pinned INTEGER DEFAULT 0,
    sort_rank INTEGER,
    last_latency_22 INTEGER,
    last_latency_414 INTEGER,
    last_latency_2122 INTEGER,
    last_latency_optional INTEGER,
    last_latency_socks INTEGER,
    last_speed_kbps REAL,
    status TEXT
  );
  `);

  ensureColumn("servers", "country_code", "TEXT");
  ensureColumn("servers", "country_flag", "TEXT");
  ensureColumn("servers", "is_pinned", "INTEGER DEFAULT 0");
  ensureColumn("servers", "sort_rank", "INTEGER");
  ensureColumn("servers", "last_latency_socks", "INTEGER");
  ensureColumn("servers", "last_speed_kbps", "REAL");

  console.log("Database initialized at:", dbPath);
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };
