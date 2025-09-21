require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const getFrames = require('gif-frames');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
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
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616', '1419340737048350880'];
const MAX_WORDS_FOR_AI = 50;
const MIN_CHARS_FOR_AI = 4;
const COOLDOWN_SECONDS = 5;
const NOTIFICATION_COOLDOWN_MINUTES = 10;
const otherBotPrefixes = ['?', '!', 'db!', 'c!', '*'];
const emojiSpamRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>){10,}/;
const mediaUrlRegex = /https?:\/\/(media\.tenor\.com|tenor\.com|giphy\.com|i\.imgur\.com|cdn\.discordapp\.com|img\.youtube\.com)\S+/i;
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

let activeTextModel = 'gemini-2.5-flash';
const fallbackTextModel = 'gemini-2.5-flash-lite';
let hasSwitchedTextFallback = false;

let activeImageModel = 'gemini-2.5-pro';
const fallbackImageModel = 'gemini-1.5-pro-latest';
let hasSwitchedImageFallback = false;

const level3Words = [ 'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers', 'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri' ];
const level2Words = [ 'kundo', 'kundy', 'píčo', 'pico', 'pičo', 'čuráku', 'curaku', 'čůráku', 'píčus', 'picus', 'zmrd', 'zmrde', 'mrdko', 'buzerant', 'buzna', 'šulin', 'zkurvysyn', 'kurva', 'kurvo', 'kurvy', 'píča', 'pica', 'čurák', 'curak', 'šukat', 'mrdat', 'bitch', 'b*tch', 'whore', 'slut', 'faggot', 'motherfucker', 'asshole', 'assh*le', 'bastard', 'cunt', 'c*nt', 'dickhead', 'dick', 'pussy', 'fuck', 'f*ck', 'fck', 'kys', 'kill yourself', 'go kill yourself', 'zabij se', 'fuk' ];
const level1Words = [ 'debil', 'kretén', 'sračka', 'doprdele', 'píčo', 'pičo', 'fakin', 'curak', 'píča' ];

const level3Regex = new RegExp(`\\b(${level3Words.join('|')})\\b`, 'i');
const level2Regex = new RegExp(`\\b(${level2Words.join('|')})\\b`, 'i');
const level1Regex = new RegExp(`\\b(${level1Words.join('|')})\\b`, 'i');

const userCooldowns = new Map();
let lastLimitNotificationTimestamp = 0;

const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } catch (err) {}
let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } catch (err) {}

function saveRatings() { try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } catch (err) {} }
function saveMessageCounts() { try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } catch (err) {} }
function calculateAverage(userId) { const userRatings = ratings[userId] || []; if (userRatings.length === 0) return 5.0; let average = userRatings.reduce((a, b) => a + b, 0) / userRatings.length; return Math.max(0, Math.min(10, average));}
async function updateRoleStatus(userId, guild, sourceMessage = null) { try { if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return; const member = await guild.members.fetch(userId).catch(() => null); const role = guild.roles.cache.get(roleId); if (!member || !role) return; const averageRating = calculateAverage(userId); const hasRole = member.roles.cache.has(roleId); if (averageRating > 9 && !hasRole) { await member.roles.add(role); const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } else if (averageRating <= 9 && hasRole) { await member.roles.remove(role); const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } } catch (error) {} }
function addRating(userId, rating, reason = "") { if (!ratings[userId]) ratings[userId] = []; ratings[userId].push(rating); if (ratings[userId].length > 10) ratings[userId].shift(); saveRatings(); console.log(`Uživatel ${userId} dostal hodnocení ${rating}. ${reason}`);}
function cleanupOldRatings() { let changed = false; for (const userId in ratings) { if (ratings[userId].length > 10) { ratings[userId] = ratings[userId].slice(-10); changed = true; } } if (changed) saveRatings(); }
cleanupOldRatings();

async function resolveMediaUrl(url) {
    if (url && (url.includes('tenor.com/view') || url.includes('giphy.com/gifs'))) {
        try {
            const response = await axios.get(url, { timeout: 3000 });
            const html = response.data;
            const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
            if (match && match[1]) {
                console.log(`Přeloženo URL: ${url} -> ${match[1]}`);
                return match[1];
            }
        } catch (error) {
            console.error(`Nepodařilo se přeložit URL: ${url}`);
        }
    }
    return url;
}

async function analyzeText(text) {
    if (!geminiApiKey) return false;
    const prompt = `Jsi AI moderátor pro neformální chat. Je následující text urážlivý, toxický nebo jde o šikanu v kontextu konverzace mezi přáteli? Ignoruj běžná sprostá slova použitá jako citoslovce. Zaměř se pouze na přímé útoky na ostatní uživatele. Odpověz jen "ANO" (pokud je to útok) nebo "NE". Text: "${text}"`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 5 } };
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${activeTextModel}:generateContent?key=${geminiApiKey}`, requestBody);
        const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) { return false; }
        const result = candidateText.trim().toUpperCase();
        return result.includes("ANO");
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if ((status === 429 || status === 404) && !hasSwitchedTextFallback) {
            console.warn(`Model ${activeTextModel} selhal (stav: ${status}). Přepínám na záložní model.`);
            activeTextModel = fallbackTextModel; hasSwitchedTextFallback = true;
            try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`🟡 **VAROVÁNÍ:** Primární AI model pro text selhal. Automaticky přepínám na záložní model.`); } catch (err) {}
            return analyzeText(text);
        }
        if (status === 429) { return 'API_LIMIT'; }
        return false;
    }
}

async function analyzeImage(imageUrl) {
    if (!imageUrl || !geminiApiKey) return false;
    try {
        let imageBuffer = (await axios.get(imageUrl, { responseType: 'arraybuffer' })).data;
        let mimeType = (await axios.head(imageUrl)).headers['content-type'];
        if (mimeType.includes('gif')) {
            const frames = await getFrames({ url: imageBuffer, frames: 'all', outputType: 'png', quality: 10 });
            if (frames.length === 0) return false;
            const middleFrameIndex = Math.floor(frames.length / 2);
            const frameStream = frames[middleFrameIndex].getImage();
            const chunks = [];
            await new Promise((resolve, reject) => { frameStream.on('data', chunk => chunks.push(chunk)); frameStream.on('error', reject); frameStream.on('end', resolve); });
            imageBuffer = Buffer.concat(chunks); mimeType = 'image/png';
        }
        if (mimeType.startsWith('image/')) {
            imageBuffer = await sharp(imageBuffer).resize({ width: 512, withoutEnlargement: true }).toBuffer();
        } else { return false; }
        const base64Image = imageBuffer.toString('base64');
        const prompt = `Jsi AI moderátor pro herní Discord server. Posuď, jestli je tento obrázek skutečně nevhodný pro komunitu (pornografie, gore, explicitní násilí, nenávistné symboly, rasismus). Ignoruj herní násilí, krev ve hrách, herní UI a běžné memy. Odpověz jen "ANO" nebo "NE".`;
        const requestBody = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }] };
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${activeImageModel}:generateContent?key=${geminiApiKey}`, requestBody);
        if (!response.data.candidates || response.data.candidates.length === 0) { return 'FILTERED'; }
        const result = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
        return result.includes("ANO");
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if ((status === 429 || status === 404 || status === 500) && !hasSwitchedImageFallback) {
            console.warn(`Model obrázků ${activeImageModel} selhal (stav: ${status}). Přepínám na záložní model.`);
            activeImageModel = fallbackImageModel; hasSwitchedImageFallback = true;
            try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`🟠 **VAROVÁNÍ:** Primární AI model pro obrázky selhal. Přepínám na záložní.`); } catch (err) {}
            return analyzeImage(imageUrl);
        }
        return 'FILTERED';
    }
}

async function moderateMessage(message) {
    if (!message.guild || !message.author || message.author.bot) return false;
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member || member.roles.cache.has(ownerRoleId)) return false;
    
    if (aiModerationChannelIds.includes(message.channel.id)) {
        let mediaUrl = null;
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.size < MAX_FILE_SIZE_BYTES) {
                mediaUrl = attachment.url;
            }
        }
        if (!mediaUrl && message.embeds.length > 0) {
            const embed = message.embeds[0];
            if (embed.image) mediaUrl = embed.image.url;
            else if (embed.thumbnail) mediaUrl = embed.thumbnail.url;
            else if (embed.video) mediaUrl = embed.video.url;
            else if (embed.url) mediaUrl = embed.url; // Záchrana pro embedy, které jsou jen odkaz
        }
        if (!mediaUrl) {
            const match = message.content.match(mediaUrlRegex);
            if (match) mediaUrl = match[0];
        }

        if (mediaUrl) {
            const directMediaUrl = await resolveMediaUrl(mediaUrl);
            const imageResult = await analyzeImage(directMediaUrl);
            
            if (imageResult === true) {
                addRating(message.author.id, -2, `Důvod: Nevhodný obrázek/GIF (detekováno AI)`);
                await updateRoleStatus(message.author.id, message.guild, message);
                try {
                    await message.delete();
                    const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj obrázek/GIF byl vyhodnocen jako nevhodný a tvé hodnocení bylo sníženo.`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
                } catch (err) {}
                return true;
            } else if (imageResult === 'FILTERED') {
                console.log(`Zpráva od ${message.author.tag} byla automaticky smazána kvůli bezpečnostnímu filtru AI.`);
                try {
                    await message.delete();
                    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder().setColor('#FFA500').setTitle('🗑️ Automaticky smazáno').setDescription(`Zpráva od <@${message.author.id}> byla preventivně smazána, protože ji bezpečnostní filtr AI odmítl zpracovat.\n\n**Uživateli nebyly strženy žádné body.**`).setImage(directMediaUrl).setTimestamp();
                        await logChannel.send({ embeds: [embed] });
                    }
                } catch (err) {}
                return true;
            }
        }
        
        let textToAnalyze = message.content;
        if (message.embeds.length > 0 && message.embeds[0].description) {
            textToAnalyze += ' ' + message.embeds[0].description;
        }
        textToAnalyze = textToAnalyze.replace(mediaUrlRegex, '').trim();
        
        if (textToAnalyze.length === 0) return false;

        if (emojiSpamRegex.test(textToAnalyze)) {
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, hoď se do klidu, tolik emoji není nutný! 😂`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        if (level3Regex.test(textToAnalyze)) {
            ratings[message.author.id] = [0]; saveRatings();
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil přísně zakázané slovo. Tvoje hodnocení bylo **resetováno na 0**!`); setTimeout(() => warningMsg.delete().catch(() => {}), 20000); } catch (err) {}
            return true;
        }
        if (level2Regex.test(textToAnalyze)) {
            addRating(message.author.id, -3, "Důvod: Hrubá urážka");
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za toto chování ti byl snížen rating o **3 body**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        if (level1Regex.test(textToAnalyze)) {
            addRating(message.author.id, -1, "Důvod: Nevhodné slovo");
            await updateRoleStatus(message.author.id, message.guild, message);
            try { const warningReply = await message.reply(`Slovník prosím. 🤫 Za tuto zprávu ti byl lehce snížen rating.`); setTimeout(() => warningReply.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        const wordCount = textToAnalyze.split(' ').length;
        if (textToAnalyze.length >= MIN_CHARS_FOR_AI && wordCount <= MAX_WORDS_FOR_AI) {
            const now = Date.now();
            const lastCheck = userCooldowns.get(message.author.id);
            if (!lastCheck || (now - lastCheck > COOLDOWN_SECONDS * 1000)) {
                userCooldowns.set(message.author.id, now);
                const toxicityResult = await analyzeText(textToAnalyze);
                if (toxicityResult === true) {
                    addRating(message.author.id, -2, `Důvod: Toxická zpráva (detekováno AI)`);
                    await updateRoleStatus(message.author.id, message.guild, message);
                    try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla nevhodná a tvé hodnocení bylo sníženo.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                    return true;
                } else if (toxicityResult === 'API_LIMIT') {
                    const now = Date.now();
                    if (now - lastLimitNotificationTimestamp > NOTIFICATION_COOLDOWN_MINUTES * 60 * 1000) {
                        lastLimitNotificationTimestamp = now;
                        try { const reply = await message.reply(`AI nemohla tuto zprávu ověřit, protože si dala šlofíka na pár hodin!`); setTimeout(() => reply.delete().catch(() => {}), 300000); } catch(err) {}
                    }
                }
            }
        }
    }
    return false;
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
    const oldTimeoutEnd = oldMember.communicationDisabledUntilTimestamp;
    const newTimeoutEnd = newMember.communicationDisabledUntilTimestamp;
    if (newTimeoutEnd && newTimeoutEnd > Date.now() && newTimeoutEnd !== oldTimeoutEnd) {
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
    if (otherBotPrefixes.some(p => message.content.startsWith(p))) return;
    
    if (!message.content.startsWith(prefix)) {
        const wasModerated = await moderateMessage(message);
        if (!wasModerated && message.channel.id === activityChannelId) {
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
            const reply = await message.channel.send({ content: 'Na tohle nemáš oprávnění, kámo. ✋', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        const user = message.mentions.users.first();
        if (!user) {
            const reply = await message.channel.send({ content: 'Bruh, koho mám jako hodnotit? Musíš někoho @označit! 🤔', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return;
        }
        if (user.id === message.author.id) {
            const reply = await message.channel.send({ content: 'Snažíš se sám sobě dát 10/10, co? Hezký pokus, ale zastavil jsem tě v čas. 😂', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return;
        }
        const rating = parseFloat(args[1]); 
        if (isNaN(rating) || rating < -10 || rating > 10) {
            const reply = await message.channel.send({ content: 'Stupnice je 1 až 10. 🔢', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 15000);
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
        const averageRating = calculateAverage(user.id);
        let scoreMsg;
        if (targetUser.id === message.author.id) {
            scoreMsg = `🌟 <@${targetUser.id}> Tvé hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**`;
        } else {
            scoreMsg = `🌟 Průměrné hodnocení <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`;
        }
        const reply = await message.channel.send(scoreMsg);
        setTimeout(() => reply.delete().catch(() => {}), 10000);
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) {
        try { await newMessage.fetch(); } catch { return; }
    }
    if (newMessage.author.bot || !newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    await moderateMessage(newMessage);
});

client.login(process.env.BOT_TOKEN);
