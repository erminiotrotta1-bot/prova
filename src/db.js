const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'collaboratore')),
  attivo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY,
  lead_id          TEXT NOT NULL UNIQUE,
  lead_type        TEXT,
  origine          TEXT,
  cognome          TEXT,
  nome             TEXT,
  cod_fiscale      TEXT,
  targa            TEXT,
  scadenza_polizza TEXT,
  email            TEXT,
  cellulare        TEXT,
  cap              TEXT,
  civico           TEXT,
  provincia        TEXT,
  comune           TEXT,
  indirizzo        TEXT,
  id_preventivo    TEXT,
  gia_cliente      TEXT,
  agenzia          TEXT,
  consenso         TEXT,
  data_creazione   TEXT,
  data_modifica    TEXT,
  assegnato_a      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contatti (
  id         INTEGER PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  modalita   TEXT NOT NULL CHECK (modalita IN ('telefono', 'email')),
  esito      TEXT NOT NULL,
  nota       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contatti_lead ON contatti(lead_id, id);

CREATE TABLE IF NOT EXISTS imports (
  id         INTEGER PRIMARY KEY,
  filename   TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  nuovi      INTEGER NOT NULL,
  aggiornati INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
