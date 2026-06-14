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
    new SlashCommandBuilder().setName('verify').setDescription('Get your verification link'),
    new SlashCommandBuilder().setName('profile').setDescription('View a player\'s profile').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('View top 10'),
    new SlashCommandBuilder().setName('report').setDescription('Report a 1v1 match').addUserOption(o => o.setName('opponent').setDescription('Opponent').setRequired(true)).addUserOption(o => o.setName('winner').setDescription('Who won? (you or opponent)').setRequired(true)),
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

    if (interaction.commandName === 'verify') {
      const embed = new EmbedBuilder()
        .setTitle('⚓ Forsaken Tide — Verify')
        .setDescription(`Click below to join the leaderboard:\n\n[**Verify with Discord**](${SERVER_URL}/login)\n\nAfter logging in, set your Roblox username and build on your profile page.`)
        .setColor(0xFFD700)
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'profile') {
      const target = interaction.options.getUser('user') || interaction.user;
      const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(target.id);
      if (!user) return interaction.reply({ content: 'Not registered. Use `/verify`.', ephemeral: true });
      const rank = db.prepare('SELECT COUNT(*) as r FROM users WHERE elo > ?').get(user.elo).r + 1;
      const embed = new EmbedBuilder()
        .setTitle(user.username).setThumbnail(user.avatar_url || target.displayAvatarURL()).setColor(0xFFD700)
        .addFields(
          { name: '◆ ELO', value: `**${user.elo}**`, inline: true },
          { name: '◉ W/L', value: `${user.wins}W / ${user.losses}L`, inline: true },
          { name: '■ Win Rate', value: `${user.wins + user.losses > 0 ? Math.round(user.wins / (user.wins + user.losses) * 100) : 0}%`, inline: true },
          { name: '⛓ Roblox', value: user.roblox_username || 'Not set', inline: true },
          { name: '⚔ Build', value: user.build || 'Not set', inline: true },
          { name: '# Rank', value: `#${rank}`, inline: true },
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'leaderboard') {
      const top = db.prepare('SELECT username, elo, wins, losses FROM users ORDER BY elo DESC LIMIT 10').all();
      if (top.length === 0) return interaction.reply({ content: 'No players yet. Use `/verify` to join!', ephemeral: true });
      const desc = top.map((p, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `${m} **${p.username}** — ${p.elo} ELO (${p.wins}W/${p.losses}L)`;
      }).join('\n');
      const embed = new EmbedBuilder().setTitle('⚓ Forsaken Tide — Top 10').setDescription(desc).setColor(0xFFD700).setFooter({ text: 'Full leaderboard at ' + SERVER_URL });
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'report') {
      const opponent = interaction.options.getUser('opponent');
      const winner = interaction.options.getUser('winner');
      if (opponent.id === winner.id) return interaction.reply({ content: 'Opponent and winner cannot be the same.', ephemeral: true });
      if (opponent.bot) return interaction.reply({ content: 'Bots cannot play.', ephemeral: true });

      const p1 = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
      const p2 = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(opponent.id);
      if (!p1) return interaction.reply({ content: 'You are not registered. Use `/verify`.', ephemeral: true });
      if (!p2) return interaction.reply({ content: 'Opponent is not registered.', ephemeral: true });

      const res = await fetch(`${SERVER_URL}/api/match/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p1_discord_id: interaction.user.id, p2_discord_id: opponent.id, winner_discord_id: winner.id }),
      });
      const data = await res.json();
      if (!data.success) return interaction.reply({ content: 'Error: ' + (data.error || 'Unknown'), ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle('⚔ Match Reported')
        .setDescription(`**${data.winner}** won!`)
        .setColor(winner.id === interaction.user.id ? 0x00FF88 : 0xFF4466)
        .addFields(
          { name: p1.username, value: `${p1.elo} → ${data.p1.elo} (${data.p1.change > 0 ? '+' : ''}${data.p1.change})`, inline: true },
          { name: p2.username, value: `${p2.elo} → ${data.p2.elo} (${data.p2.change > 0 ? '+' : ''}${data.p2.change})`, inline: true },
        )
        .setFooter({ text: 'Forsaken Tide Leaderboard' });
      return interaction.reply({ embeds: [embed] });
    }
  });

  client.login(TOKEN).catch(e => console.error('[Bot] Login error:', e));
}

module.exports = { initBot };
