require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { initBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'forsaken-tide-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

function calcElo(ratingA, ratingB, winnerIsA, loserScore) {
  const K = 8;
  const multiplier = loserScore === 4 ? 0.5 : 1;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));
  let changeA, changeB;
  if (winnerIsA) {
    changeA = Math.max(1, Math.round(K * multiplier * (1 - expectedA)));
    changeB = Math.min(-1, Math.round(K * multiplier * (0 - expectedB)));
  } else {
    changeA = Math.min(-1, Math.round(K * multiplier * (0 - expectedA)));
    changeB = Math.max(1, Math.round(K * multiplier * (1 - expectedB)));
  }
  return { changeA, changeB };
}

function getRank(elo) {
  if (elo >= 701) return 'Z';
  if (elo >= 551) return 'Y';
  if (elo >= 401) return 'X';
  if (elo >= 350) return 'S';
  if (elo >= 250) return 'A';
  if (elo >= 100) return 'B';
  return 'C';
}

function getFraction(elo) {
  if (elo >= 551) return 3;
  if (elo >= 350) return 2;
  return 1;
}

function isAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

const admins = (process.env.ADMIN_ID || '').split(',').map(s => s.trim());

function isAdminUser(discordId) {
  return admins.includes(discordId);
}

function isAdmin(req, res, next) {
  if (req.session.user && isAdminUser(req.session.user.discord_id)) return next();
  res.status(403).send('Not authorized');
}

app.get('/', async (req, res) => {
  const rows = (await db.query('SELECT id, discord_id, username, roblox_username, region, elo, elo_display, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT 100')).rows;
  const top = rows.map(r => ({ ...r, rank: getRank(r.elo), fraction: getFraction(r.elo) }));
  const total = (await db.query('SELECT COUNT(*) as count FROM users')).rows[0].count;
  const matches = (await db.query('SELECT COUNT(*) as count FROM matches')).rows[0].count;
  res.render('index', { user: req.session.user || null, top, total, matches, admin: process.env.ADMIN_ID, isAdmin: req.session.user ? isAdminUser(req.session.user.discord_id) : false, admins });
});

app.get('/info', async (req, res) => {
  res.render('info', { user: req.session.user || null, isAdmin: req.session.user ? isAdminUser(req.session.user.discord_id) : false });
});

app.get('/leaderboard', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const rows = (await db.query('SELECT id, discord_id, username, roblox_username, region, elo, elo_display, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT $1 OFFSET $2', [limit, (page - 1) * limit])).rows;
  const players = rows.map(r => ({ ...r, rank: getRank(r.elo), fraction: getFraction(r.elo) }));
  const total = (await db.query('SELECT COUNT(*) as count FROM users')).rows[0].count;
  res.render('leaderboard', { user: req.session.user || null, players, page, pages: Math.ceil(total / limit), total, admins });
});

app.get('/profile/:id', async (req, res) => {
  const playerRaw = (await db.query('SELECT * FROM users WHERE id = $1', [req.params.id])).rows[0];
  if (!playerRaw) return res.status(404).send('User not found');
  const player = { ...playerRaw, rank: getRank(playerRaw.elo), fraction: getFraction(playerRaw.elo) };
  const matchHistory = (await db.query(`
    SELECT m.*, p1.username as p1_name, p2.username as p2_name
    FROM matches m
    JOIN users p1 ON m.player1_id = p1.id
    JOIN users p2 ON m.player2_id = p2.id
    WHERE m.player1_id = $1 OR m.player2_id = $2
    ORDER BY m.played_at DESC LIMIT 50
  `, [player.id, player.id])).rows;
  res.render('profile', { user: req.session.user || null, player, matchHistory, admin: process.env.ADMIN_ID, isAdmin: req.session.user ? isAdminUser(req.session.user.discord_id) : false, admins });
});

app.get('/admin', isAuth, isAdmin, async (req, res) => {
  const rows = (await db.query('SELECT id, discord_id, username, region, elo, elo_display, wins, losses, verified FROM users ORDER BY elo DESC')).rows;
  const players = rows.map(r => ({ ...r, rank: getRank(r.elo) }));
  res.render('admin', { user: req.session.user, players });
});

app.get('/login', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');
  try {
    const tok = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(r => r.json());

    if (!tok.access_token) return res.redirect('/');

    const du = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then(r => r.json());

    let user = (await db.query('SELECT * FROM users WHERE discord_id = $1', [du.id])).rows[0];
    if (!user) {
      const result = await db.query(
        'INSERT INTO users (discord_id, username, avatar_url, elo, verified) VALUES ($1, $2, $3, 0, 1) RETURNING *',
        [du.id, du.username, `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png`]
      );
      user = result.rows[0];
    } else {
      await db.query('UPDATE users SET username = $1, avatar_url = $2, verified = 1 WHERE discord_id = $3', [
        du.username,
        `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png`,
        du.id
      ]);
    }
    req.session.user = user;
    res.redirect('/');
  } catch { res.redirect('/'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/api/leaderboard', async (req, res) => {
  const rows = (await db.query('SELECT id, username, roblox_username, region, elo, elo_display, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT 100')).rows;
  res.json(rows.map(r => ({ ...r, rank: getRank(r.elo), fraction: getFraction(r.elo) })));
});

app.post('/api/update-profile', isAuth, async (req, res) => {
  const { roblox_username, region, build, build_items } = req.body;
  await db.query('UPDATE users SET roblox_username = $1, region = $2, build = $3, build_items = $4 WHERE discord_id = $5', [
    roblox_username || '', region || '', build || '', build_items || '', req.session.user.discord_id
  ]);
  req.session.user = (await db.query('SELECT * FROM users WHERE discord_id = $1', [req.session.user.discord_id])).rows[0];
  res.json({ success: true });
});

app.post('/api/match/result', async (req, res) => {
  const { p1_discord_id, p2_discord_id, winner_discord_id, winner_score, loser_score } = req.body;
  const p1 = (await db.query('SELECT * FROM users WHERE discord_id = $1', [p1_discord_id])).rows[0];
  const p2 = (await db.query('SELECT * FROM users WHERE discord_id = $1', [p2_discord_id])).rows[0];
  if (!p1 || !p2) return res.status(400).json({ error: 'User not found' });

  const f1 = getFraction(p1.elo);
  const f2 = getFraction(p2.elo);
  if (f1 !== f2) return res.status(400).json({ error: `Fraction mismatch: F${f1} vs F${f2}. Players must be in the same fraction to fight.` });

  const weekCount = (await db.query(
    `SELECT COUNT(*) as cnt FROM matches WHERE ((player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1)) AND date_trunc('week', played_at) = date_trunc('week', NOW())`,
    [p1.id, p2.id]
  )).rows[0].cnt;
  if (parseInt(weekCount) >= 3) return res.status(400).json({ error: `These players have already fought ${weekCount} times this week. Max 3 matches per week against the same opponent.` });

  const wIsP1 = winner_discord_id === p1.discord_id;
  const wId = wIsP1 ? p1.id : p2.id;
  const ws = Math.min(winner_score || 5, 10);
  const ls = Math.min(loser_score || 0, 9);
  const { changeA, changeB } = calcElo(p1.elo, p2.elo, wIsP1, ls);

  await db.query(
    'INSERT INTO matches (player1_id, player2_id, winner_id, player1_elo_before, player2_elo_before, player1_elo_change, player2_elo_change, winner_score, loser_score) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [p1.id, p2.id, wId, p1.elo, p2.elo, changeA, changeB, ws, ls]
  );

  await db.query('UPDATE users SET elo = elo + $1, wins = wins + 1 WHERE id = $2', [changeA, p1.id]);
  await db.query('UPDATE users SET elo = elo + $1, losses = losses + 1 WHERE id = $2', [changeB, p1.id]);
  await db.query('UPDATE users SET elo = elo + $1, wins = wins + 1 WHERE id = $2', [changeB, p2.id]);
  await db.query('UPDATE users SET elo = elo + $1, losses = losses + 1 WHERE id = $2', [changeA, p2.id]);

  const np1 = (await db.query('SELECT * FROM users WHERE id = $1', [p1.id])).rows[0];
  const np2 = (await db.query('SELECT * FROM users WHERE id = $1', [p2.id])).rows[0];
  res.json({ success: true, p1: { elo_before: p1.elo, elo: np1.elo, change: changeA }, p2: { elo_before: p2.elo, elo: np2.elo, change: changeB }, winner: wIsP1 ? p1.username : p2.username, winner_score: ws, loser_score: ls });
});

app.post('/api/admin/update-user', isAuth, isAdmin, async (req, res) => {
  try {
    const { id, elo, wins, losses, build, roblox_username } = req.body;
    if (req.session.user.username !== 'valtheoneandonly') {
      if (!/^\d+$/.test(String(elo)) || !/^\d+$/.test(String(wins)) || !/^\d+$/.test(String(losses))) {
        return res.status(400).json({ error: 'ELO, wins, and losses must be numeric' });
      }
      await db.query('UPDATE users SET elo = $1, wins = $2, losses = $3, build = $4, roblox_username = $5 WHERE id = $6', [elo, wins, losses, build || '', roblox_username || '', id]);
    } else {
      const eloVal = /^\d+$/.test(String(elo)) ? elo : null;
      const winsVal = /^\d+$/.test(String(wins)) ? wins : 0;
      const lossesVal = /^\d+$/.test(String(losses)) ? losses : 0;
      await db.query('UPDATE users SET elo = COALESCE($1, elo), elo_display = CASE WHEN $1 IS NULL THEN $2 ELSE \'\' END, wins = $3, losses = $4, build = $5, roblox_username = $6 WHERE id = $7', [eloVal, elo, winsVal, lossesVal, build || '', roblox_username || '', id]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Admin update error:', e);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/admin/delete-user', isAuth, isAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    await db.query('DELETE FROM matches WHERE player1_id = $1 OR player2_id = $2', [id, id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Admin delete error:', e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`[Forsaken Tide] Server → http://localhost:${PORT}`);
  await db.init();
  if (process.env.DISCORD_TOKEN) initBot();
});
