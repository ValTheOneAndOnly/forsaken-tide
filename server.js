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

// ─── ELO Calculation ───
function calcElo(ratingA, ratingB, winnerIsA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));
  if (winnerIsA) return { changeA: Math.round(K * (1 - expectedA)), changeB: Math.round(K * (0 - expectedB)) };
  return { changeA: Math.round(K * (0 - expectedA)), changeB: Math.round(K * (1 - expectedB)) };
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

// ─── Pages ───
app.get('/', (req, res) => {
  const top = db.prepare('SELECT id, username, roblox_username, elo, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT 100').all();
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const matches = db.prepare('SELECT COUNT(*) as count FROM matches').get().count;
  res.render('index', { user: req.session.user || null, top, total, matches, admin: process.env.ADMIN_ID, isAdmin: req.session.user ? isAdminUser(req.session.user.discord_id) : false });
});

app.get('/leaderboard', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const players = db.prepare('SELECT id, username, roblox_username, elo, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT ? OFFSET ?').all(limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  res.render('leaderboard', { user: req.session.user || null, players, page, pages: Math.ceil(total / limit), total });
});

app.get('/profile/:id', (req, res) => {
  const player = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).send('User not found');
  const matchHistory = db.prepare(`
    SELECT m.*, p1.username as p1_name, p2.username as p2_name
    FROM matches m
    JOIN users p1 ON m.player1_id = p1.id
    JOIN users p2 ON m.player2_id = p2.id
    WHERE m.player1_id = ? OR m.player2_id = ?
    ORDER BY m.played_at DESC LIMIT 50
  `).all(player.id, player.id);
  res.render('profile', { user: req.session.user || null, player, matchHistory, admin: process.env.ADMIN_ID, isAdmin: req.session.user ? isAdminUser(req.session.user.discord_id) : false });
});

app.get('/admin', isAuth, isAdmin, (req, res) => {
  const players = db.prepare('SELECT id, discord_id, username, elo, wins, losses, verified FROM users ORDER BY elo DESC').all();
  res.render('admin', { user: req.session.user, players });
});

// ─── Discord OAuth ───
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

    let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(du.id);
    if (!user) {
      const info = db.prepare('INSERT INTO users (discord_id, username, avatar_url, verified) VALUES (?, ?, ?, 1)').run(
        du.id, du.global_name || du.username,
        `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png`
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET username = ?, avatar_url = ?, verified = 1 WHERE discord_id = ?').run(
        du.global_name || du.username,
        `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png`,
        du.id
      );
    }
    req.session.user = user;
    res.redirect('/');
  } catch { res.redirect('/'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ─── API ───
app.get('/api/leaderboard', (req, res) => {
  res.json(db.prepare('SELECT id, username, roblox_username, elo, wins, losses, build, build_items, avatar_url, verified FROM users ORDER BY elo DESC LIMIT 100').all());
});

app.post('/api/update-profile', isAuth, (req, res) => {
  const { roblox_username, build, build_items } = req.body;
  db.prepare('UPDATE users SET roblox_username = ?, build = ?, build_items = ? WHERE discord_id = ?').run(
    roblox_username || '', build || '', build_items || '', req.session.user.discord_id
  );
  req.session.user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(req.session.user.discord_id);
  res.json({ success: true });
});

// ─── Bot Report API (called from bot.js) ───
app.post('/api/match/result', (req, res) => {
  const { p1_discord_id, p2_discord_id, winner_discord_id, winner_score, loser_score } = req.body;
  const p1 = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(p1_discord_id);
  const p2 = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(p2_discord_id);
  if (!p1 || !p2) return res.status(400).json({ error: 'User not found' });

  const wIsP1 = winner_discord_id === p1.discord_id;
  const wId = wIsP1 ? p1.id : p2.id;
  const { changeA, changeB } = calcElo(p1.elo, p2.elo, wIsP1);
  const ws = winner_score || 5;
  const ls = loser_score || 0;

  db.prepare('INSERT INTO matches (player1_id, player2_id, winner_id, player1_elo_before, player2_elo_before, player1_elo_change, player2_elo_change, winner_score, loser_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(p1.id, p2.id, wId, p1.elo, p2.elo, changeA, changeB, ws, ls);

  db.prepare('UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?').run(changeA, p1.id);
  db.prepare('UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?').run(changeB, p1.id);
  db.prepare('UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?').run(changeB, p2.id);
  db.prepare('UPDATE users SET elo = elo + ?, losses = losses + 1 WHERE id = ?').run(changeA, p2.id);

  const np1 = db.prepare('SELECT * FROM users WHERE id = ?').get(p1.id);
  const np2 = db.prepare('SELECT * FROM users WHERE id = ?').get(p2.id);
  res.json({ success: true, p1: { elo_before: p1.elo, elo: np1.elo, change: changeA }, p2: { elo_before: p2.elo, elo: np2.elo, change: changeB }, winner: wIsP1 ? p1.username : p2.username, winner_score: ws, loser_score: ls });
});

// ─── Admin API ───
app.post('/api/admin/update-user', isAuth, isAdmin, (req, res) => {
  const { id, elo, wins, losses, build, roblox_username } = req.body;
  db.prepare('UPDATE users SET elo = ?, wins = ?, losses = ?, build = ?, roblox_username = ? WHERE id = ?').run(elo, wins, losses, build || '', roblox_username || '', id);
  res.json({ success: true });
});

app.post('/api/admin/delete-user', isAuth, isAdmin, (req, res) => {
  const { id } = req.body;
  db.prepare('DELETE FROM matches WHERE player1_id = ? OR player2_id = ?').run(id, id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`[Forsaken Tide] Server → http://localhost:${PORT}`);
  if (process.env.DISCORD_TOKEN) initBot();
});
