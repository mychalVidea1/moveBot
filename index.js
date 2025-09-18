require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.GuildMember]
});

// ======================= NASTAVENÍ =======================
const prefix = 'm!';
const roleId = process.env.ROLE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const errorGif = 'https://tenor.com/view/womp-womp-gif-9875106689398845891';

const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const startupChannelId = '1005985776158388264';
const logChannelId = '1025689879973203968';
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616'];
const MAX_WORDS_FOR_AI = 50;

const level3Words = [
    'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers',
    'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri'
];
const level2Words = [
    'kundo', 'píčo', 'pico', 'pičo', 'kokote', 'kkt', 'čuráku', 'curaku', 'čůráku',
    'zmrd', 'hajzl', 'mrdko', 'buzerant', 'faggot', 'motherfucker', 'mf', 'kys', 'kill yourself'
];
const level1Words = [
    'kurva', 'kurvo', 'kunda', 'píča', 'pica', 'kokot', 'čurák', 'curak',
    'mrd', 'šukat', 'mrdat', 'debil', 'blbec', 'idiot', 'hovno', 'kretén', 'magor',
    'fuck', 'f*ck', 'fck', 'fuk', 'shit', 'sh*t', 'sht', 'bitch', 'b*tch',
    'cunt', 'c*nt', 'asshole', 'assh*le', 'bastard', 'dick', 'pussy'
];
// ==============================================================================

const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);

let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } catch (err) {}
let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } catch (err) {}

function saveRatings() {
    try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } catch (err) {}
}
function saveMessageCounts() {
    try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } catch (err) {}
}
function calculateAverage(userId) {
    const userRatings = ratings[userId] || [];
    if (userRatings.length === 0) return 5.0;
    let average = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
    return Math.max(0, Math.min(10, average));
}
async function updateRoleStatus(userId, guild, sourceMessage = null) {
    try {
        if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return;
        const averageRating = calculateAverage(userId);
        const hasRole = member.roles.cache.has(roleId);
        if (averageRating > 9 && !hasRole) {
            await member.roles.add(role);
            const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`;
            if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) {
                sourceMessage.reply(messageContent).catch(() => {});
            } else {
                const channel = await client.channels.fetch(logChannelId).catch(() => null);
                if (channel) channel.send(messageContent).catch(() => {});
            }
        } else if (averageRating <= 9 && hasRole) {
            await member.roles.remove(role);
            const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`;
            if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) {
                sourceMessage.reply(messageContent).catch(() => {});
            } else {
                const channel = await client.channels.fetch(logChannelId).catch(() => null);
                if (channel) channel.send(messageContent).catch(() => {});
            }
        }
    } catch (error) {}
}
function addRating(userId, rating, reason = "") {
    if (!ratings[userId]) ratings[userId] = [];
    ratings[userId].push(rating);
    if (ratings[userId].length > 10) ratings[userId].shift();
    saveRatings();
    console.log(`Uživatel ${userId} dostal hodnocení ${rating}. ${reason}`);
}
function cleanupOldRatings() {
    let changed = false;
    for (const userId in ratings) {
        if (ratings[userId].length > 10) {
            ratings[userId] = ratings[userId].slice(-10);
            changed = true;
        }
    }
    if (changed) saveRatings();
}
cleanupOldRatings();

async function isToxic(text) {
    if (!geminiApiKey) {
        console.log("Gemini API klíč chybí.");
        return false;
    }
    try {
        const prompt = `Je tento text toxický nebo urážlivý? Odpověz jen "ANO"/"NE" nic víc. Text: "${text}"`;
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 5 },
            }
        );
        const result = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
        console.log(`Gemini analýza pro text "${text}": Odpověď - ${result}`);
        return result.includes("ANO");
    } catch (error) {
        console.error("Chyba při komunikaci s Gemini API:", error.response ? error.response.data.error : error.message);
        return false;
    }
}

client.once('clientReady', async () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀').setDescription('Systémy nastartovány, databáze pročištěna. Jsem připraven hodnotit vaše chování! 👀').setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208').setTimestamp().setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) {}
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;
    if ((!oldTimeout && newTimeout) || (newTimeout > oldTimeout)) {
        addRating(newMember.id, -3, "Důvod: Timeout");
        await updateRoleStatus(newMember.id, newMember.guild, null);
        try {
            const channel = await client.channels.fetch(logChannelId);
            if (channel) channel.send(`Uživatel <@${newMember.id}> dostal timeout a jeho hodnocení bylo sníženo o **3 body**.`);
        } catch (err) {}
    }
});

client.on('guildBanAdd', async (ban) => {
    ratings[ban.user.id] = [0];
    saveRatings();
    await updateRoleStatus(ban.user.id, ban.guild, null);
    try {
        const channel = await client.channels.fetch(logChannelId);
        if (channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`);
    } catch (err) {}
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    if (!message.content.startsWith(prefix)) {
        if (message.member && message.member.roles.cache.has(ownerRoleId)) return;
        
        if (aiModerationChannelIds.includes(message.channel.id)) {
            const messageContent = message.content.toLowerCase().replace(/\s/g, '');

            if (level3Words.some(word => messageContent.includes(word))) {
                ratings[message.author.id] = [0]; saveRatings();
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil zakázané slovo. Jeho hodnocení bylo **resetováno na 0**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                return;
            }
            if (level2Words.some(word => messageContent.includes(word))) {
                addRating(message.author.id, -3, "Důvod: Hrubá urážka");
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za hrubé chování ti byl snížen rating o **3 body**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
                return;
            }
            if (level1Words.some(word => messageContent.includes(word))) {
                addRating(message.author.id, -1, "Důvod: Nevhodné slovo");
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za nevhodné chování ti byl snížen rating o **1 bod**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
                return;
            }

            const wordCount = message.content.split(' ').length;
            if (wordCount <= MAX_WORDS_FOR_AI) {
                if (await isToxic(message.content)) {
                    addRating(message.author.id, -2, `Důvod: Toxická zpráva (detekováno AI)`);
                    await updateRoleStatus(message.author.id, message.guild, message);
                    try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla vyhodnocena jako nevhodná a tvé hodnocení bylo sníženo.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                    return;
                }
            }
        }

        if (message.channel.id === activityChannelId) {
            if (!messageCounts[message.author.id]) messageCounts[message.author.id] = 0;
            messageCounts[message.author.id]++;
            if (messageCounts[message.author.id] >= 10) {
                if (!ratings[message.author.id] || ratings[message.author.id].length === 0) {
                    addRating(message.author.id, 5, "Důvod: První odměna za aktivitu");
                } else {
                    addRating(message.author.id, 10, "Důvod: Aktivita");
                }
                await updateRoleStatus(message.author.id, message.guild, message);
                messageCounts[message.author.id] = 0;
            }
            saveMessageCounts();
        }
        return; 
    }

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'rate') {
        try { await message.delete(); } catch (err) {}
        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const reply = await message.channel.send({ content: 'Na tohle nemáš oprávnění, kámo. ✋ Jen pro adminy.', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        const user = message.mentions.users.first();
        if (!user) {
            const reply = await message.channel.send({ content: 'Bruh, koho mám jako hodnotit? Musíš někoho @označit! 🤔', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        if (user.id === message.author.id) {
            const reply = await message.channel.send({ content: 'Snažíš se sám sobě dát 10/10, co? Hezký pokus, ale takhle to nefunguje. 😂', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        const rating = parseFloat(args[1]); 
        if (isNaN(rating) || rating < -10 || rating > 10) {
            const reply = await message.channel.send({ content: 'Stupnice je -10 až 10, bro. Ani víc, ani míň. 🔢', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        addRating(user.id, rating, `Ručně adminem ${message.author.tag}`);
        await updateRoleStatus(user.id, message.guild, message);
        const averageRating = calculateAverage(user.id);
        const reply = await message.channel.send(`**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Průměr: **\`${averageRating.toFixed(2)} / 10\`**`);
        setTimeout(() => reply.delete().catch(() => {}), 20000);
    }

    if (command === 'score') {
        if (message.mentions.everyone) {
            try { await message.delete(); } catch (err) {}
            const userIds = Object.keys(ratings);
            if (userIds.length === 0) return message.channel.send({ content: 'Síň slávy je prázdná!', embeds: [new EmbedBuilder().setImage(errorGif)] });
            userIds.sort((a, b) => calculateAverage(b) - calculateAverage(a));
            const scoreEmbed = new EmbedBuilder().setColor('#5865F2').setTitle('✨🏆 SÍŇ SLÁVY 🏆✨').setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n').setTimestamp().setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
            let leaderboardString = '';
            let rank = 1;
            for (const userId of userIds) {
                const averageRating = calculateAverage(userId);
                if (!ratings[userId] || ratings[userId].length === 0) continue;
                let roleIndicator = '';
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member && member.roles.cache.has(roleId)) roleIndicator = ' 👑';
                } catch (error) {}
                let rankDisplay;
                if (rank === 1) rankDisplay = '🥇'; else if (rank === 2) rankDisplay = '🥈'; else if (rank === 3) rankDisplay = '🥉'; else rankDisplay = `**${rank}.**`;
                leaderboardString += `${rankDisplay} <@${userId}> ⮞ \` ${averageRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
                rank++;
            }
            scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
            return message.channel.send({ embeds: [scoreEmbed] });
        }
        
        try { await message.delete(); } catch (err) {}
        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        const targetUser = message.mentions.users.first() || message.author;
        const userRatings = ratings[targetUser.id] || [];
        if (userRatings.length === 0) {
            let errorMsg;
            if (targetUser.id === message.author.id) errorMsg = 'Zatím nemáš žádné hodnocení, kámo! 🤷';
            else errorMsg = `Uživatel <@${targetUser.id}> je zatím nepopsaný list. 📜`;
            
            const reply = await message.channel.send({ content: errorMsg, embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        const averageRating = calculateAverage(targetUser.id);
        let scoreMsg;
        if (targetUser.id === message.author.id) {
            scoreMsg = `🌟 <@${targetUser.id}> Tvé průměrné hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**`;
        } else {
            scoreMsg = `🌟 Průměrné hodnocení uživatele <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`;
        }
        const reply = await message.channel.send(scoreMsg);
        setTimeout(() => reply.delete().catch(() => {}), 10000);
    }
});

client.login(process.env.BOT_TOKEN);
