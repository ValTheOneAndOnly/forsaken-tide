const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL DEFAULT 'Unknown',
    roblox_username TEXT DEFAULT '',
    elo INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    build TEXT DEFAULT '',
    build_items TEXT DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    avatar_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player1_id INTEGER NOT NULL REFERENCES users(id),
    player2_id INTEGER NOT NULL REFERENCES users(id),
    winner_id INTEGER NOT NULL REFERENCES users(id),
    player1_elo_before INTEGER NOT NULL,
    player2_elo_before INTEGER NOT NULL,
    player1_elo_change INTEGER NOT NULL DEFAULT 0,
    player2_elo_change INTEGER NOT NULL DEFAULT 0,
    winner_score INTEGER NOT NULL DEFAULT 5,
    loser_score INTEGER NOT NULL DEFAULT 0,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// add columns if table already exists
try { db.exec('ALTER TABLE matches ADD COLUMN winner_score INTEGER NOT NULL DEFAULT 5'); } catch {}
try { db.exec('ALTER TABLE matches ADD COLUMN loser_score INTEGER NOT NULL DEFAULT 0'); } catch {}
`);

try { db.exec('ALTER TABLE matches ADD COLUMN winner_score INTEGER NOT NULL DEFAULT 5'); } catch (e) {}
try { db.exec('ALTER TABLE matches ADD COLUMN loser_score INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN build_items TEXT DEFAULT ""'); } catch (e) {}

module.exports = db;
