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
      elo_display TEXT DEFAULT '',
      region TEXT DEFAULT '',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      build TEXT DEFAULT '',
      build_items TEXT DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_display TEXT DEFAULT ''`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT DEFAULT ''`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_streak INTEGER DEFAULT 0`);
  await db.query(`UPDATE users SET current_streak = 0 WHERE current_streak IS NULL`);
  await db.query(`UPDATE users SET max_streak = 0 WHERE max_streak IS NULL`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      end_date TIMESTAMP,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE seasons ADD COLUMN IF NOT EXISTS is_preparation BOOLEAN DEFAULT false`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS elo_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      elo INTEGER NOT NULL,
      season_id INTEGER REFERENCES seasons(id),
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  await db.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id)`);

  // Seed preparation season if none exist
  const seasonCount = (await db.query('SELECT COUNT(*) as cnt FROM seasons')).rows[0].cnt;
  if (parseInt(seasonCount) === 0) {
    await db.query(`INSERT INTO seasons (name, start_date, is_active, is_preparation) VALUES ('Preparation', CURRENT_TIMESTAMP, true, true)`);
  }
};

module.exports = db;