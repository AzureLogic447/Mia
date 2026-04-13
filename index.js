const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const databasePath = './database.json';

let data = {};
if (fs.existsSync(databasePath)) {
    data = JSON.parse(fs.readFileSync(databasePath));
    // Migration: ensure all users have required fields
    for (const userId in data) {
        const user = data[userId];
        if (user.xp === undefined) user.xp = 0;
        if (user.level === undefined) user.level = 1;
        if (user.coins === undefined) user.coins = 0;
        if (user.lastDaily === undefined) user.lastDaily = 0;
        if (user.warnings === undefined) user.warnings = [];
    }
    // Save migrated data
    fs.writeFileSync(databasePath, JSON.stringify(data, null, 2));
}

const commands = [
    {
        name: 'balance',
        description: 'Check your XP, level, and coins',
    },
    {
        name: 'daily',
        description: 'Claim 100 coins once per day',
    },
    {
        name: 'leaderboard',
        description: 'Show top 5 users by level and XP',
    },
    {
        name: 'kick',
        description: 'Kick a user from the server',
        options: [
            {
                name: 'user',
                description: 'The user to kick',
                type: 6,
                required: true,
            },
            {
                name: 'reason',
                description: 'Reason for kicking',
                type: 3,
                required: false,
            },
        ],
    },
    {
        name: 'ban',
        description: 'Ban a user from the server',
        options: [
            {
                name: 'user',
                description: 'The user to ban',
                type: 6,
                required: true,
            },
            {
                name: 'reason',
                description: 'Reason for banning',
                type: 3,
                required: false,
            },
        ],
    },
    {
        name: 'warn',
        description: 'Warn a user',
        options: [
            {
                name: 'user',
                description: 'The user to warn',
                type: 6,
                required: true,
            },
            {
                name: 'reason',
                description: 'Reason for warning',
                type: 3,
                required: false,
            },
        ],
    },
    {
        name: 'warnings',
        description: 'Check warnings for a user',
        options: [
            {
                name: 'user',
                description: 'The user to check',
                type: 6,
                required: true,
            },
        ],
    },
    {
        name: 'clear',
        description: 'Delete a number of messages',
        options: [
            {
                name: 'number',
                description: 'Number of messages to delete (1-100)',
                type: 4,
                required: true,
            },
        ],
    },
];

client.once('ready', async () => {
    console.log('Bot is online!');

    const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    if (!data[userId]) {
        data[userId] = { xp: 0, level: 1, coins: 0, lastDaily: 0, warnings: [] };
    }

    const xpGain = Math.floor(Math.random() * 11) + 15;
    data[userId].xp += xpGain;

    const coinsGain = Math.floor(Math.random() * 5) + 1;
    data[userId].coins += coinsGain;

    let currentLevel = data[userId].level;
    let xpNeeded = 5 * (currentLevel ** 2) + 50 * currentLevel + 100;

    while (data[userId].xp >= xpNeeded) {
        data[userId].level++;
        currentLevel++;
        xpNeeded = 5 * (currentLevel ** 2) + 50 * currentLevel + 100;
        message.channel.send(`Congratulations ${message.author}! You reached level ${currentLevel}!`);
    }

    fs.writeFileSync(databasePath, JSON.stringify(data, null, 2));
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'balance') {
        const userId = interaction.user.id;
        const userData = data[userId] || { xp: 0, level: 1, coins: 0 };
        await interaction.reply(`XP: ${userData.xp}, Level: ${userData.level}, Coins: ${userData.coins}`);
    } else if (commandName === 'daily') {
        const userId = interaction.user.id;
        const now = Date.now();
        const lastClaim = data[userId]?.lastDaily || 0;
        const timeDiff = now - lastClaim;
        const dayMs = 24 * 60 * 60 * 1000;
        if (timeDiff < dayMs) {
            const remaining = Math.ceil((dayMs - timeDiff) / (60 * 60 * 1000));
            await interaction.reply(`You can claim daily coins again in ${remaining} hours.`);
        } else {
            data[userId] = data[userId] || { xp: 0, level: 1, coins: 0, lastDaily: 0, warnings: [] };
            data[userId].coins += 100;
            data[userId].lastDaily = now;
            fs.writeFileSync(databasePath, JSON.stringify(data, null, 2));
            await interaction.reply('You claimed 100 coins!');
        }
    } else if (commandName === 'leaderboard') {
        const sorted = Object.entries(data).sort((a, b) => {
            if (b[1].level !== a[1].level) return b[1].level - a[1].level;
            return b[1].xp - a[1].xp;
        }).slice(0, 5);

        const embed = new EmbedBuilder()
            .setTitle('Leaderboard')
            .setColor(0x0099FF);

        let description = '';
        for (let i = 0; i < sorted.length; i++) {
            const [id, userData] = sorted[i];
            try {
                const user = await client.users.fetch(id);
                description += `${i + 1}. ${user.username} - Level ${userData.level}, XP ${userData.xp}\n`;
            } catch (error) {
                description += `${i + 1}. Unknown User - Level ${userData.level}, XP ${userData.xp}\n`;
            }
        }
        embed.setDescription(description || 'No users yet.');

        await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'kick') {
        if (!interaction.member.permissions.has('KickMembers')) {
            return interaction.reply({ content: 'You do not have permission to kick members.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(user.id);
        if (!member) return interaction.reply('User not found in this server.');
        if (!member.kickable) return interaction.reply('I cannot kick this user.');
        await member.kick(reason);
        await interaction.reply(`Kicked ${user.tag} for: ${reason}`);
    } else if (commandName === 'ban') {
        if (!interaction.member.permissions.has('BanMembers')) {
            return interaction.reply({ content: 'You do not have permission to ban members.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.guild.members.cache.get(user.id);
        if (!member) return interaction.reply('User not found in this server.');
        if (!member.bannable) return interaction.reply('I cannot ban this user.');
        await member.ban({ reason });
        await interaction.reply(`Banned ${user.tag} for: ${reason}`);
    } else if (commandName === 'warn') {
        if (!interaction.member.permissions.has('ManageMessages')) {
            return interaction.reply({ content: 'You do not have permission to warn members.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const userId = user.id;
        data[userId] = data[userId] || { xp: 0, level: 1, coins: 0, lastDaily: 0, warnings: [] };
        data[userId].warnings.push({ reason, timestamp: Date.now() });
        fs.writeFileSync(databasePath, JSON.stringify(data, null, 2));
        await interaction.reply(`Warned ${user.tag} for: ${reason}`);
    } else if (commandName === 'warnings') {
        const user = interaction.options.getUser('user');
        const userId = user.id;
        const userData = data[userId];
        if (!userData || !userData.warnings || userData.warnings.length === 0) {
            return interaction.reply(`${user.tag} has no warnings.`);
        }
        const warnings = userData.warnings.map((w, i) => `${i + 1}. ${w.reason} (${new Date(w.timestamp).toLocaleString()})`).join('\n');
        await interaction.reply(`Warnings for ${user.tag}:\n${warnings}`);
    } else if (commandName === 'clear') {
        if (!interaction.member.permissions.has('ManageMessages')) {
            return interaction.reply({ content: 'You do not have permission to manage messages.', ephemeral: true });
        }
        const number = interaction.options.getInteger('number');
        if (number < 1 || number > 100) return interaction.reply('Number must be between 1 and 100.');
        const messages = await interaction.channel.messages.fetch({ limit: number });
        await interaction.channel.bulkDelete(messages);
        await interaction.reply(`Deleted ${messages.size} messages.`);
    }
});

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!');
});

server.listen(3000, () => {
    console.log('Keep-alive server listening on port 3000');
});

client.login(process.env.BOT_TOKEN);