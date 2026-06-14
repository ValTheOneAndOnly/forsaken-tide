require('dotenv').config();
const db = require('./db');
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;

function initBot() {
  const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;

  const commands = [
    new SlashCommandBuilder().setName('ftverify').setDescription('Get your verification link'),
    new SlashCommandBuilder().setName('ftprofile').setDescription('View a player\'s profile').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
    new SlashCommandBuilder().setName('ftleaderboard').setDescription('View top 10'),
    new SlashCommandBuilder().setName('ftlog').setDescription('Log a FT5 1v1 match')
      .addUserOption(o => o.setName('player1').setDescription('First player').setRequired(true))
      .addUserOption(o => o.setName('player2').setDescription('Second player').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('Who won? (player1 or player2)').setRequired(true))
      .addIntegerOption(o => o.setName('loser_score').setDescription('Loser score (0-4)').setMinValue(0).setMaxValue(4).setRequired(true)),
    new SlashCommandBuilder().setName('ftcommands').setDescription('Show all Forsaken Tide commands'),
    new SlashCommandBuilder().setName('ftsync').setDescription('Sync rank roles for all users or a specific user').addUserOption(o => o.setName('user').setDescription('User to sync').setRequired(false)),

  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const RANKS = ['C', 'B', 'A', 'S', 'X', 'Y', 'Z'];
  function getRankFromElo(elo) {
    if (elo >= 701) return 'Z';
    if (elo >= 551) return 'Y';
    if (elo >= 401) return 'X';
    if (elo >= 350) return 'S';
    if (elo >= 250) return 'A';
    if (elo >= 100) return 'B';
    return 'C';
  }
  async function syncRankRole(member, elo) {
    if (!member) return;
    const targetRank = getRankFromElo(elo);
    const roles = await member.guild.roles.fetch();
    const rankRoles = roles.filter(r => RANKS.includes(r.name));
    const toRemove = rankRoles.filter(r => r.name !== targetRank);
    const toAdd = rankRoles.find(r => r.name === targetRank);
    await member.roles.remove(toRemove).catch(() => {});
    if (toAdd) await member.roles.add(toAdd).catch(() => {});
  }

  client.once('ready', async () => {
    console.log(`[Bot] Logged in as ${client.user.tag}`);
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands.map(c => c.toJSON()) });
      console.log('[Bot] Commands registered');
    } catch {}
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ftverify') {
      const embed = new EmbedBuilder()
        .setTitle('⚓ Forsaken Tide — Verify')
        .setDescription(`Click below to join the leaderboard:\n\n[**Verify with Discord**](${SERVER_URL}/login)\n\nAfter logging in, set your Roblox username and build (Skilled or Normal) on your profile page.`)
        .setColor(0xFFD700)
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'ftprofile') {
      const target = interaction.options.getUser('user') || interaction.user;
      const rows = await db.query('SELECT * FROM users WHERE discord_id = $1', [target.id]);
      const user = rows.rows[0];
      if (!user) return interaction.reply({ content: 'Not registered. Use `/ftverify`.', ephemeral: true });
      const rankRes = await db.query('SELECT COUNT(*) as r FROM users WHERE elo > $1', [user.elo]);
      const rank = rankRes.rows[0].r + 1;
      const userRank = user.elo >= 701 ? 'Z' : user.elo >= 551 ? 'Y' : user.elo >= 401 ? 'X' : user.elo >= 350 ? 'S' : user.elo >= 250 ? 'A' : user.elo >= 100 ? 'B' : 'C';
      const embed = new EmbedBuilder()
        .setTitle(user.username).setThumbnail(user.avatar_url || target.displayAvatarURL()).setColor(0xFFD700)
        .addFields(
          { name: '◆ ELO', value: `**${user.elo}**`, inline: true },
          { name: '◈ Rank', value: `**${userRank}**`, inline: true },
          { name: '◉ W/L', value: `${user.wins}W / ${user.losses}L`, inline: true },
          { name: '■ Win Rate', value: `${user.wins + user.losses > 0 ? Math.round(user.wins / (user.wins + user.losses) * 100) : 0}%`, inline: true },
          { name: '⛓ Roblox', value: user.roblox_username || 'Not set', inline: true },
          { name: '⚔ Build', value: user.build ? (user.build + (user.build_items ? ' — ' + user.build_items : '')) : 'Not set', inline: true },
          { name: '# Rank', value: `#${rank}`, inline: true },
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ftleaderboard') {
      const result = await db.query('SELECT username, elo, wins, losses FROM users ORDER BY elo DESC LIMIT 10');
      const top = result.rows;
      if (top.length === 0) return interaction.reply({ content: 'No players yet. Use `/ftverify` to join!', ephemeral: true });
      const desc = top.map((p, i) => {
        const r = p.elo >= 701 ? 'Z' : p.elo >= 551 ? 'Y' : p.elo >= 401 ? 'X' : p.elo >= 350 ? 'S' : p.elo >= 250 ? 'A' : p.elo >= 100 ? 'B' : 'C';
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `${m} **${p.username}** [${r}] — ${p.elo} ELO (${p.wins}W/${p.losses}L)`;
      }).join('\n');
      const embed = new EmbedBuilder().setTitle('⚓ Forsaken Tide — Top 10').setDescription(desc).setColor(0xFFD700).setFooter({ text: 'Full leaderboard at ' + SERVER_URL });
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ftlog') {
      const p1User = interaction.options.getUser('player1');
      const p2User = interaction.options.getUser('player2');
      const winner = interaction.options.getUser('winner');
      const loserScore = interaction.options.getInteger('loser_score');
      if (!p1User || !p2User || !winner || loserScore === null) return interaction.reply({ content: 'Missing arguments.', ephemeral: true });
      if (p1User.id === p2User.id) return interaction.reply({ content: 'Players must be different.', ephemeral: true });
      if (winner.id !== p1User.id && winner.id !== p2User.id) return interaction.reply({ content: 'Winner must be player1 or player2.', ephemeral: true });
      if (p1User.bot || p2User.bot) return interaction.reply({ content: 'Bots cannot play.', ephemeral: true });

      const p1 = (await db.query('SELECT * FROM users WHERE discord_id = $1', [p1User.id])).rows[0];
      const p2 = (await db.query('SELECT * FROM users WHERE discord_id = $1', [p2User.id])).rows[0];
      if (!p1) return interaction.reply({ content: `${p1User.username} is not registered. Use \`/ftverify\`.`, ephemeral: true });
      if (!p2) return interaction.reply({ content: `${p2User.username} is not registered. Use \`/ftverify\`.`, ephemeral: true });

      const res = await fetch(`${SERVER_URL}/api/match/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p1_discord_id: p1User.id, p2_discord_id: p2User.id, winner_discord_id: winner.id, winner_score: 5, loser_score: loserScore }),
      });
      const data = await res.json();
      if (!data.success) return interaction.reply({ content: 'Error: ' + (data.error || 'Unknown'), ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle('⚔ Match Logged')
        .setDescription(`**${data.winner}** won 5-${data.loser_score}`)
        .setColor(winner.id === p1User.id ? 0x00FF88 : 0xFF4466)
        .addFields(
          { name: p1.username, value: `${data.p1.elo_before} → ${data.p1.elo} (${data.p1.change > 0 ? '+' : ''}${data.p1.change})`, inline: true },
          { name: p2.username, value: `${data.p2.elo_before} → ${data.p2.elo} (${data.p2.change > 0 ? '+' : ''}${data.p2.change})`, inline: true },
        )
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const m1 = await guild.members.fetch(p1User.id).catch(() => null);
        const m2 = await guild.members.fetch(p2User.id).catch(() => null);
        if (m1) syncRankRole(m1, data.p1.elo);
        if (m2) syncRankRole(m2, data.p2.elo);
      } catch {}
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ftsync') {
      const target = interaction.options.getUser('user');
      const guild = await client.guilds.fetch(GUILD_ID);
      if (target) {
        const member = await guild.members.fetch(target.id).catch(() => null);
        if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
        const user = (await db.query('SELECT * FROM users WHERE discord_id = $1', [target.id])).rows[0];
        if (!user) return interaction.reply({ content: 'Not registered.', ephemeral: true });
        await syncRankRole(member, user.elo);
        return interaction.reply({ content: `Synced ${target.username} → ${getRankFromElo(user.elo)}`, ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const members = await guild.members.fetch();
      const users = (await db.query('SELECT discord_id, elo FROM users')).rows;
      let count = 0;
      for (const u of users) {
        const member = members.get(u.discord_id);
        if (member) { await syncRankRole(member, u.elo); count++; }
      }
      return interaction.editReply({ content: `Synced ${count} members.` });
    }

    if (interaction.commandName === 'ftcommands') {
      const embed = new EmbedBuilder()
        .setTitle('⚓ Forsaken Tide — Commands')
        .setColor(0xFFD700)
        .addFields(
          { name: '/ftverify', value: 'Get a link to log in and join the leaderboard', inline: false },
          { name: '/ftprofile', value: 'View your stats (or mention someone to see theirs)', inline: false },
          { name: '/ftleaderboard', value: 'View top 10 players with ranks', inline: false },
          { name: '/ftlog', value: 'Log a FT5 match: `/ftlog player1:@p1 player2:@p2 winner:@winner loser_score:3`', inline: false },
          { name: '/ftsync', value: 'Sync rank roles for all users or a specific user', inline: false },
          { name: '/ftcommands', value: 'Show this list', inline: false },
        )
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      return interaction.reply({ embeds: [embed] });
    }
  });

  client.login(TOKEN).catch(e => console.error('[Bot] Login error:', e));
}

module.exports = { initBot };
