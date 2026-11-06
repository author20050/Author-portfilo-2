require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const commands = require('./commands');
const settings = require('./settings');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required; copy .env.example to .env and configure it.');
if (!settings.ownerId) throw new Error('OWNER_ID is required.');
const OWNER_ID = String(settings.ownerId);
const tgBot = new Telegraf(process.env.BOT_TOKEN);
const DB = path.join(__dirname, 'database.json');
let sock = null;
let reconnectTimer = null;

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return { users: {}, stats: {}, keywordReplies: {}, readReceipts: true, games: {}, antilink: true }; }
}
function writeDb(db) { fs.writeFileSync(DB, JSON.stringify(db, null, 2)); }
const userMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('◉ PAIR DEVICE', 'get_pair'), Markup.button.callback('◌ MY STATUS', 'user_status')],
  [Markup.button.callback('▤ COMMANDS', 'menu_commands'), Markup.button.callback('⟡ GROUP TOOLS', 'menu_groups')],
  [Markup.button.callback('⌂ ADMIN CONSOLE', 'md_admin')]
]);
const adminMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('👥 USER COUNT', 'adm_users')],
  [Markup.button.callback('‹ BACK TO CONSOLE', 'menu_home')]
]);
const menuCaption = `╭─── W A L L A H I  M D ───╮\n│       PHANTOM CONSOLE      │\n│  A quiet signal in the dark│\n├───────────────────────────┤\n│ Choose a channel below ↓  │\n╰───────────────────────────╯`;
async function showMenu(ctx) {
  const image = path.join(__dirname, settings.menuImagePath);
  if (fs.existsSync(image)) return ctx.replyWithPhoto({ source: image }, { caption: menuCaption, ...userMenu() });
  return ctx.reply(menuCaption, userMenu());
}

tgBot.start(async (ctx) => {
  const db = readDb(); db.users[String(ctx.from.id)] = true; writeDb(db);
  await showMenu(ctx);
});
tgBot.command('menu', showMenu);
tgBot.command('help', (ctx) => ctx.reply('Use /menu for the Phantom Console. WhatsApp commands: !help, !menu, !ttt, !qr, !sticker, !tagall.'));
tgBot.action('menu_home', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const image = path.join(__dirname, settings.menuImagePath);
  if (ctx.callbackQuery.message?.photo) return ctx.editMessageCaption(menuCaption, userMenu()).catch(() => {});
  return ctx.editMessageText(menuCaption, userMenu()).catch(() => {});
});
tgBot.action('menu_commands', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = '▤ COMMAND INDEX\n\n!help / !menu — Help and menu\n!ttt — Play Tic-Tac-Toe\n!qr — Create a QR code\n!sticker / !compress / !enhance — Image tools\n!gif / !mp3 — Convert media (FFmpeg required)\n!tagall — Group-admin mention command';
  await ctx.editMessageText(text, Markup.inlineKeyboard([[Markup.button.callback('‹ BACK', 'menu_home')]])).catch(() => {});
});
tgBot.action('menu_groups', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText('⟡ GROUP TOOLS\n\n!tagall is restricted to group admins, capped at 100 mentions, and protected by a cooldown. Group invite links are removed only when bot admin permissions can be verified.', Markup.inlineKeyboard([[Markup.button.callback('‹ BACK', 'menu_home')]])).catch(() => {});
});
tgBot.action('get_pair', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('Pairing is owner-only. Send `.pair 2348123456789` here using the configured owner Telegram account.');
});
tgBot.action('user_status', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const role = String(ctx.from.id) === OWNER_ID ? '👑 Owner' : '👤 User';
  await ctx.reply(`╭── STATUS ──╮\nRole: ${role}\nTelegram ID: ${ctx.from.id}`);
});
tgBot.action('md_admin', async (ctx) => {
  if (String(ctx.from.id) !== OWNER_ID) return ctx.answerCbQuery('Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText('👑 WALLAHI MD // ADMIN CONSOLE', adminMenu()).catch(() => {});
});
tgBot.action('adm_users', async (ctx) => {
  if (String(ctx.from.id) !== OWNER_ID) return ctx.answerCbQuery('Owner only', { show_alert: true }).catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(`Registered Telegram users: ${Object.keys(readDb().users || {}).length}`);
});
tgBot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text.startsWith('.pair ')) return;
  if (String(ctx.from.id) !== OWNER_ID) return ctx.reply('❌ Pairing is restricted to the configured owner.');
  const phone = text.slice(6).replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) return ctx.reply('❌ Use an international phone number, e.g. `.pair 2348123456789`');
  if (!sock) return ctx.reply('❌ WhatsApp socket is not ready yet.');
  try {
    await ctx.reply('⏳ Requesting a pairing code…');
    const code = await sock.requestPairingCode(phone);
    await ctx.reply(`╭── PAIRING CODE ──╮\n\n${code}\n\nWhatsApp → Linked devices → Link with phone number. Keep this code private.`);
  } catch { await ctx.reply('❌ Pairing failed. Check the phone number and try again later.'); }
});
tgBot.catch((err) => console.error('Telegram handler error:', err.message));

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session'));
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, logger: pino({ level: 'silent' }), printQRInTerminal: false, auth: state, browser: ['Wallahi MD', 'Chrome', '1.0.0'] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') console.log('✅ WhatsApp connected');
      if (connection === 'close') {
        sock = null;
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          clearTimeout(reconnectTimer); reconnectTimer = setTimeout(startWhatsApp, 5000);
        } else console.error('WhatsApp session logged out; remove session/ and pair again.');
      }
    });
    sock.ev.on('group-participants.update', update => commands.onGroupParticipantsUpdate(sock, update));
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages || []) {
        if (!m.message || m.key.fromMe) continue;
        const from = m.key.remoteJid;
        if (!from || from === 'status@broadcast') continue;
        const db = readDb();
        if (db.readReceipts !== false) await sock.readMessages([m.key]).catch(() => {});
        const isGroup = from.endsWith('@g.us');
        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || m.message.documentMessage?.caption || '';
        try { await commands(sock, from, body, m, isGroup); }
        catch (err) { console.error('WhatsApp command error:', err.message); }
      }
    });
  } catch (err) {
    console.error('WhatsApp startup failed:', err.message);
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(startWhatsApp, 10000);
  }
}

startWhatsApp();
tgBot.launch().then(() => console.log('🚀 Wallahi MD Telegram bot running')).catch(err => console.error('Telegram launch failed:', err.message));
process.once('SIGINT', () => { tgBot.stop('SIGINT'); if (sock) sock.end(undefined); });
process.once('SIGTERM', () => { tgBot.stop('SIGTERM'); if (sock) sock.end(undefined); });
