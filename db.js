const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = {};

db.query = (text, params) => pool.query(text, params);

db.init = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL DEFAULT 'Unknown',
      roblox_username TEXT DEFAULT '',
      elo INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      build TEXT DEFAULT '',
      build_items TEXT DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER NOT NULL REFERENCES users(id),
      winner_id INTEGER NOT NULL REFERENCES users(id),
      player1_elo_before INTEGER NOT NULL,
      player2_elo_before INTEGER NOT NULL,
      player1_elo_change INTEGER NOT NULL DEFAULT 0,
      player2_elo_change INTEGER NOT NULL DEFAULT 0,
      winner_score INTEGER NOT NULL DEFAULT 5,
      loser_score INTEGER NOT NULL DEFAULT 0,
      played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

module.exports = db;