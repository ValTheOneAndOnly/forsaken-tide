require('dotenv').config();
const db = require('./db');
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;

function initBot() {
  const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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

  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

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
      const embed = new EmbedBuilder()
        .setTitle(user.username).setThumbnail(user.avatar_url || target.displayAvatarURL()).setColor(0xFFD700)
        .addFields(
          { name: '◆ ELO', value: `**${user.elo}**`, inline: true },
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
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `${m} **${p.username}** — ${p.elo} ELO (${p.wins}W/${p.losses}L)`;
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
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'ftcommands') {
      const embed = new EmbedBuilder()
        .setTitle('⚓ Forsaken Tide — Commands')
        .setColor(0xFFD700)
        .addFields(
          { name: '/ftverify', value: 'Get a link to log in and join the leaderboard', inline: false },
          { name: '/ftprofile', value: 'View your stats (or mention someone to see theirs)', inline: false },
          { name: '/ftleaderboard', value: 'View top 10 players', inline: false },
          { name: '/ftlog', value: 'Log a FT5 match: `/ftlog player1:@p1 player2:@p2 winner:@winner loser_score:3`', inline: false },
          { name: '/ftcommands', value: 'Show this list', inline: false },
        )
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      return interaction.reply({ embeds: [embed] });
    }
  });

  client.login(TOKEN).catch(e => console.error('[Bot] Login error:', e));
}

module.exports = { initBot };
