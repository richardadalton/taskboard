import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data.db')

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    oauth_id   TEXT UNIQUE NOT NULL,
    username   TEXT NOT NULL,
    email      TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    sess       TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boards (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS board_members (
    board_id  INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'collaborator',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (board_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id          INTEGER PRIMARY KEY,
    board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    token       TEXT UNIQUE NOT NULL,
    invited_by  INTEGER NOT NULL REFERENCES users(id),
    accepted_at TEXT,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY,
    board_id     INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    notes        TEXT,
    due_date     TEXT,
    priority     TEXT NOT NULL DEFAULT 'normal',
    status       TEXT NOT NULL DEFAULT 'todo',
    completed_at TEXT,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    position     REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);
`)

// ── Migrations for existing databases ────────────────────────────────────────
// Each is wrapped in try/catch so a fresh DB (which already has the right
// schema above) silently skips any that would otherwise fail.

// lists → boards
try { db.exec('ALTER TABLE lists RENAME TO boards') } catch {}
// list_members → board_members
try { db.exec('ALTER TABLE list_members RENAME TO board_members') } catch {}
// invitations.list_id → board_id
try { db.exec('ALTER TABLE invitations RENAME COLUMN list_id TO board_id') } catch {}
// tasks.list_id → board_id
try { db.exec('ALTER TABLE tasks RENAME COLUMN list_id TO board_id') } catch {}
// status column (added in previous iteration)
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'`)
  db.exec(`UPDATE tasks SET status = 'done' WHERE completed_at IS NOT NULL`)
} catch {}
// Re-index on renamed column
try {
  db.exec(`
    DROP INDEX IF EXISTS idx_tasks_list_id;
    CREATE INDEX IF NOT EXISTS idx_tasks_board_id ON tasks(board_id);
  `)
} catch {}
try { db.exec('DROP INDEX IF EXISTS idx_list_members_user_id') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_board_members_user_id ON board_members(user_id)') } catch {}

// Remove expired sessions on startup
db.prepare('DELETE FROM sessions WHERE expired_at < ?').run(Date.now())
