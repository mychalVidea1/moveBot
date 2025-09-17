require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');

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
const errorGif = 'https://tenor.com/view/womp-womp-gif-9875106689398845891';
const activityChannelId = '875097279650992128'; 
const startupChannelId = '1025689879973203968';

const nWords = [
    'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers',
    'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri'
];

// ROZŠÍŘENÝ SEZNAM
const inappropriateWords = [
    // CZ vulgární
    'kurva', 'kurvo', 'kurvy', 'kunda', 'píča', 'pica', 'píčo', 'pico', 'pičo',
    'kokot', 'kokote', 'kkt', 'čurák', 'curak', 'čůrák', 'mrdka', 'mrd', 'šukat',
    // CZ urážky
    'debil', 'blbec', 'idiot', 'zmrd', 'hajzl', 'hovno', 'kretén', 'čůrák',
    // EN
    'fuck', 'f*ck', 'fck', 'fuk', 'shit', 'sh*t', 'sht', 'bitch', 'b*tch',
    'cunt', 'c*nt', 'asshole', 'assh*le', 'bastard', 'motherfucker', 'mf', 'dick', 'pussy'
];
// ==============================================================================


const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);

let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } 
catch (err) { console.log('Soubor s hodnocením nebyl nalezen.'); }

let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } 
catch (err) { console.log('Soubor s počtem zpráv nebyl nalezen.'); }

function saveRatings() {
    try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } 
    catch (err) { console.error('CHYBA: Nepodařilo se uložit hodnocení!', err); }
}

function saveMessageCounts() {
    try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } 
    catch (err) { console.error('CHYBA: Nepodařilo se uložit počty zpráv!', err); }
}

// ===== NOVINKA: FUNKCE PRO VÝPOČET A OMEZENÍ PRŮMĚRU =====
function calculateAverage(userId) {
    const userRatings = ratings[userId] || [];
    if (userRatings.length === 0) return 5.0; // Neutrální startovní skóre

    let average = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
    
    // Omezí skóre v rozmezí 0 až 10
    return Math.max(0, Math.min(10, average));
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


client.once('clientReady', async () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀')
                .setDescription('Systémy nastartovány, databáze pročištěna. Jsem připraven hodnotit vaše chování, kulišáci! 👀')
                .setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208')
                .setTimestamp()
                .setFooter({ text: 'Powered by mychalVidea1' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) { console.error(`Nepodařilo se odeslat startup zprávu. Chyba:`, error); }
});

// Event pro timeout - s imunitou pro adminy
client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (newMember.permissions.has(PermissionsBitField.Flags.Administrator)) return; // ===== IMUNITA ZDE =====
    
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;
    if ((!oldTimeout && newTimeout) || (newTimeout > oldTimeout)) {
        addRating(newMember.id, -3, "Důvod: Timeout");
        const channel = newMember.guild.systemChannel;
        if(channel) channel.send(`Uživatel <@${newMember.id}> dostal timeout a jeho hodnocení bylo sníženo o **3 body**.`);
    }
});

// Event pro ban
client.on('guildBanAdd', async (ban) => {
    ratings[ban.user.id] = [0];
    saveRatings();
    const channel = ban.guild.systemChannel;
    if(channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Automoderace a odměny (pokud zpráva NENÍ příkaz)
    if (!message.content.startsWith(prefix)) {
        // ===== IMUNITA ZDE =====
        if (message.member && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const messageContent = message.content.toLowerCase().replace(/\s/g, '');

        if (nWords.some(word => messageContent.includes(word))) {
            ratings[message.author.id] = [0]; // Reset na 0
            saveRatings();
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil zakázané slovo. Jeho hodnocení bylo **resetováno na 0**.`);
                setTimeout(() => warningMsg.delete(), 15000);
            } catch (err) { console.error("Chybí mi oprávnění 'Spravovat zprávy'."); }
            return;
        }
        
        if (inappropriateWords.some(word => messageContent.includes(word))) {
            addRating(message.author.id, -1, "Důvod: Nevhodné slovo");
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`<@${message.author.id}>, za nevhodné chování ti byl snížen rating o **1 bod**.`);
                setTimeout(() => warningMsg.delete(), 10000);
            } catch (err) { console.error("Chybí mi oprávnění 'Spravovat zprávy'."); }
            return;
        }

        if (message.channel.id === activityChannelId) {
            if (!messageCounts[message.author.id]) messageCounts[message.author.id] = 0;
            messageCounts[message.author.id]++;

            if (messageCounts[message.author.id] >= 10) {
                // ===== ODMĚNA JE TEĎ PLNÝ POČET BODŮ =====
                addRating(message.author.id, 10, "Důvod: Aktivita");
                messageCounts[message.author.id] = 0;
            }
            saveMessageCounts();
        }
        return; 
    }

    // Příkazy
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'rate') {
        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.channel.send({ content: 'Na tohle nemáš oprávnění, kámo. ✋ Jen pro adminy.', embeds: [errorEmbed] });
        const user = message.mentions.users.first();
        if (!user) return message.channel.send({ content: 'Bruh, koho mám jako hodnotit? Musíš někoho @označit! 🤔', embeds: [errorEmbed] });
        if (user.id === message.author.id) return message.channel.send({ content: 'Snažíš se sám sobě dát 10/10, co? Hezký pokus, ale takhle to nefunguje. 😂', embeds: [errorEmbed] });
        
        const rating = parseFloat(args[1]); 
        if (isNaN(rating) || rating < -10 || rating > 10) return message.channel.send({ content: 'Stupnice je -10 až 10, bro. Ani víc, ani míň. 🔢', embeds: [errorEmbed] });
        
        addRating(user.id, rating, `Ručně adminem ${message.author.tag}`);
        
        const averageRating = calculateAverage(user.id); // Použití nové funkce
        
        message.channel.send(`**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Průměr: **\`${averageRating.toFixed(2)} / 10\`**`);
        
        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return message.channel.send({ content: "Chyba: Nemám oprávnění spravovat role.", embeds: [errorEmbed] });
            const member = await message.guild.members.fetch(user.id);
            const role = message.guild.roles.cache.get(roleId);
            if (!member || !role) return;

            if (averageRating > 9) {
                if (!member.roles.cache.has(role.id)) await member.roles.add(role);
            } else {
                if (member.roles.cache.has(role.id)) await member.roles.remove(role);
            }
        } catch (error) { console.error('Došlo k chybě při správě rolí:', error); }
    }

    if (command === 'score') {
        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        if (message.mentions.everyone) {
            const userIds = Object.keys(ratings);
            if (userIds.length === 0) return message.channel.send({ content: 'Síň slávy je prázdná!', embeds: [errorEmbed] });
            
            // Seřadíme podle vypočítaného a omezeného průměru
            userIds.sort((a, b) => calculateAverage(b) - calculateAverage(a));

            const scoreEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('✨🏆 SÍŇ SLÁVY 🏆✨')
                .setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n')
                .setTimestamp()
                .setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
            let leaderboardString = '';
            let rank = 1;
            for (const userId of userIds) {
                const averageRating = calculateAverage(userId); // Použití nové funkce
                // Přeskočíme uživatele s defaultním skóre, pokud nemají žádné reálné hodnocení
                if (!ratings[userId] || ratings[userId].length === 0) continue;

                let roleIndicator = '';
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member && member.roles.cache.has(roleId)) roleIndicator = ' 👑';
                } catch (error) { /* Ignorujeme chyby */ }
                let rankDisplay;
                if (rank === 1) rankDisplay = '🥇';
                else if (rank === 2) rankDisplay = '🥈';
                else if (rank === 3) rankDisplay = '🥉';
                else rankDisplay = `**${rank}.**`;
                leaderboardString += `${rankDisplay} <@${userId}> ⮞ \` ${averageRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
                rank++;
            }
            scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
            return message.channel.send({ embeds: [scoreEmbed] });
        }
        
        const targetUser = message.mentions.users.first() || message.author;
        const userRatings = ratings[targetUser.id] || [];
        if (userRatings.length === 0) {
            if (targetUser.id === message.author.id) return message.channel.send({ content: 'Zatím nemáš žádné hodnocení, kámo! 🤷', embeds: [errorEmbed] });
            else return message.channel.send({ content: `Uživatel <@${targetUser.id}> je zatím nepopsaný list. 📜`, embeds: [errorEmbed] });
        }
        
        const averageRating = calculateAverage(targetUser.id); // Použití nové funkce

        if (targetUser.id === message.author.id) {
            return message.channel.send(`🌟 Tvé průměrné hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**`);
        } else {
            return message.channel.send(`🌟 Průměrné hodnocení uživatele <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`);
        }
    }
});

client.login(process.env.BOT_TOKEN);
