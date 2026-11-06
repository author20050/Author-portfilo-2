const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');
const ffmpeg = require('fluent-ffmpeg');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const settings = require('./settings');

const cooldowns = new Map();
const scheduled = new Map();
const wins = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
];

function loadDb() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'database.json'), 'utf8')); }
  catch { return { users: {}, stats: {}, keywordReplies: {}, readReceipts: true, games: {}, antilink: true }; }
}
function saveDb(db) {
  fs.writeFileSync(path.join(__dirname, 'database.json'), JSON.stringify(db, null, 2));
}
function jidBase(jid = '') { return jid.split(':')[0]; }
function isAdmin(p) { return p?.admin === 'admin' || p?.admin === 'superadmin'; }
function winner(board) {
  for (const [a, b, c] of wins) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}
function renderBoard(board) {
  const glyph = (v, i) => v === 'X' ? '❌' : v === 'O' ? '⭕' : `${i + 1}️⃣`;
  return `${glyph(board[0], 0)} ${glyph(board[1], 1)} ${glyph(board[2], 2)}\n${glyph(board[3], 3)} ${glyph(board[4], 4)} ${glyph(board[5], 5)}\n${glyph(board[6], 6)} ${glyph(board[7], 7)} ${glyph(board[8], 8)}`;
}
function minimax(board, turn) {
  const w = winner(board);
  if (w === 'O') return 10;
  if (w === 'X') return -10;
  if (board.every(Boolean)) return 0;
  const scores = [];
  for (let i = 0; i < 9; i++) if (!board[i]) {
    board[i] = turn;
    scores.push(minimax(board, turn === 'O' ? 'X' : 'O'));
    board[i] = null;
  }
  return turn === 'O' ? Math.max(...scores) : Math.min(...scores);
}
function botMove(board) {
  let best = -Infinity, choice = -1;
  for (let i = 0; i < 9; i++) if (!board[i]) {
    board[i] = 'O'; const score = minimax(board, 'X'); board[i] = null;
    if (score > best) { best = score; choice = i; }
  }
  return choice;
}
function quotedMedia(m) {
  const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const wrapped = q.ephemeralMessage?.message || q.viewOnceMessage?.message || q;
  if (wrapped.imageMessage) return { type: 'image', message: wrapped };
  if (wrapped.videoMessage) return { type: 'video', message: wrapped };
  if (wrapped.audioMessage) return { type: 'audio', message: wrapped };
  if (wrapped.documentMessage) return { type: 'document', message: wrapped };
  return null;
}
async function getQuotedBuffer(sock, m) {
  const media = quotedMedia(m);
  if (!media) return null;
  return downloadMediaMessage({ key: m.message?.extendedTextMessage?.contextInfo?.stanzaId ? {
    remoteJid: m.key.remoteJid,
    id: m.message.extendedTextMessage.contextInfo.stanzaId,
    participant: m.message.extendedTextMessage.contextInfo.participant
  } : m.key, message: media.message }, 'buffer', {}, { logger: undefined, reuploadRequest: sock.updateMediaMessage });
}

module.exports = async function commands(sock, from, msg, m, isGroup) {
  const text = String(msg || '').trim();
  const cmd = text.split(/\s+/)[0].toLowerCase();
  const args = text.slice(cmd.length).trim();
  const db = loadDb();
  const sender = m.key.participant || m.key.remoteJid;
  db.stats[from] = (db.stats[from] || 0) + 1;
  db.users[jidBase(sender)] = true;
  saveDb(db);

  const say = async (body, extra = {}) => {
    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    return sock.sendMessage(from, { text: body, ...extra }, { quoted: m });
  };

  if (db.antilink !== false && settings.antilink && isGroup && /chat\.whatsapp\.com\//i.test(text)) {
    try {
      const metadata = await sock.groupMetadata(from);
      const participant = metadata.participants.find(p => jidBase(p.id) === jidBase(sender));
      const bot = metadata.participants.find(p => jidBase(p.id) === jidBase(sock.user?.id));
      if (!isAdmin(participant) && isAdmin(bot)) {
        await sock.sendMessage(from, { delete: m.key });
        await say('⚠️ Group invite links are restricted here.');
      }
    } catch { /* Leave the message untouched if moderation permissions cannot be verified. */ }
    return;
  }

  if (['!ping', '.ping'].includes(cmd)) return say('🏓 Pong!');
  if (['!about', '.about'].includes(cmd)) return say(`${settings.botName} — WhatsApp assistant`);
  if (['!help', '.help'].includes(cmd)) return say(
    `🤖 ${settings.botName}\n\n` +
    'Basics: !menu, !ping, !about, !stats\n' +
    'Game: !ttt (play against the bot), !ttt move 1-9\n' +
    'Media (reply to a file): !sticker, !compress, !enhance, !gif, !mp3, !docinfo\n' +
    'Utilities: !qr text, !link https://example.com, !quote your reply\n' +
    'Group admins: !tagall\n' +
    'Owner: !schedule minutes message, !read on|off'
  );
  if (['!menu', '.menu'].includes(cmd)) return say(
    `╭─── W A L L A H I  M D ───╮\n│       PHANTOM CONSOLE      │\n│  A quiet signal in the dark│\n├───────────────────────────┤\n│ !help  !stats  !ttt        │\n│ !sticker  !qr  !tagall     │\n╰───────────────────────────╯`
  );
  if (['!stats', '.stats'].includes(cmd)) return say(`📊 Messages observed in this chat: ${db.stats[from] || 0}`);

  if (cmd === '!ttt' || cmd === '.ttt') {
    if (args.toLowerCase().startsWith('move ')) {
      const game = db.games[from];
      const n = Number(args.split(/\s+/)[1]);
      if (!game) return say('Start a new game with !ttt.');
      if (!Number.isInteger(n) || n < 1 || n > 9) return say('Choose a square from 1 to 9.');
      if (game.board[n - 1]) return say('That square is occupied. Choose another.');
      game.board[n - 1] = 'X';
      let result = winner(game.board);
      if (!result && game.board.some(v => !v)) {
        const move = botMove(game.board);
        if (move >= 0) game.board[move] = 'O';
        result = winner(game.board);
      }
      const full = game.board.every(Boolean);
      if (result || full) delete db.games[from]; else db.games[from] = game;
      saveDb(db);
      return say(`${renderBoard(game.board)}\n\n${result === 'X' ? '🎉 You win!' : result === 'O' ? '🤖 I win!' : full ? '🤝 Draw!' : 'Your turn: !ttt move 1-9'}`);
    }
    db.games[from] = { board: Array(9).fill(null), startedAt: Date.now() };
    saveDb(db);
    return say(`❌ You are X; I am O. Pick a square:\n\n${renderBoard(db.games[from].board)}\n\nPlay with !ttt move 1-9`);
  }

  if (cmd === '!quote' || cmd === '.quote') {
    if (!args) return say('Reply to a message with !quote followed by your reply.');
    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo?.stanzaId) return say('Reply to the message you want to quote, then use !quote your reply.');
    return sock.sendMessage(from, { text: args, contextInfo: { stanzaId: contextInfo.stanzaId, participant: contextInfo.participant, quotedMessage: contextInfo.quotedMessage } });
  }

  if (cmd === '!qr' || cmd === '.qr') {
    if (!args) return say('Usage: !qr text or URL');
    const image = await QRCode.toBuffer(args, { type: 'png', margin: 2, width: 640 });
    return sock.sendMessage(from, { image, caption: '▰ PHANTOM QR ▰' }, { quoted: m });
  }
  if (cmd === '!link' || cmd === '.link') {
    try {
      const u = new URL(args);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('scheme');
      return say(`🔎 Link details\nHost: ${u.hostname}\nProtocol: ${u.protocol.replace(':', '')}\nPath: ${u.pathname || '/'}`);
    } catch { return say('Usage: !link https://example.com'); }
  }

  if (cmd === '!schedule' || cmd === '.schedule') {
    if (jidBase(sender) !== String(settings.ownerId)) return say('❌ Owner only.');
    const match = args.match(/^(\d{1,4})\s+([\s\S]+)/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 1440) return say('Usage: !schedule minutes message (1–1440 minutes)');
    const delay = Number(match[1]) * 60_000;
    const timer = setTimeout(() => { sock.sendMessage(from, { text: `⏰ Scheduled message\n${match[2]}` }).catch(() => {}); scheduled.delete(timer); }, delay);
    scheduled.set(timer, true);
    return say(`✅ Scheduled for ${match[1]} minute(s) from now. The bot must stay online.`);
  }
  if (cmd === '!read' || cmd === '.read') {
    if (jidBase(sender) !== String(settings.ownerId)) return say('❌ Owner only.');
    if (!['on', 'off'].includes(args.toLowerCase())) return say('Usage: !read on|off');
    db.readReceipts = args.toLowerCase() === 'on'; saveDb(db);
    return say(`Read receipts ${db.readReceipts ? 'enabled' : 'disabled'} where supported.`);
  }

  if (cmd === '!tagall' || cmd === '.tagall') {
    if (!isGroup) return say('This command only works in groups.');
    const last = cooldowns.get(from) || 0;
    if (Date.now() < last) return say(`⏳ Wait ${Math.ceil((last - Date.now()) / 1000)} seconds before tagging again.`);
    try {
      const metadata = await sock.groupMetadata(from);
      const senderP = metadata.participants.find(p => jidBase(p.id) === jidBase(sender));
      const botP = metadata.participants.find(p => jidBase(p.id) === jidBase(sock.user?.id));
      if (!isAdmin(senderP)) return say('Only group admins can use !tagall.');
      if (!isAdmin(botP)) return say('Please make the bot a group admin first.');
      const members = metadata.participants.filter(p => jidBase(p.id) !== jidBase(sock.user?.id));
      if (members.length > settings.maxTagAll) return say(`Group is over the ${settings.maxTagAll}-member mention limit.`);
      cooldowns.set(from, Date.now() + settings.tagCooldownMs);
      for (let i = 0; i < members.length; i += 20) {
        const batch = members.slice(i, i + 20);
        await sock.sendMessage(from, { text: `📢 Phantom roll call (${Math.floor(i / 20) + 1})\n${batch.map(p => `@${p.id.split('@')[0].split(':')[0]}`).join(' ')}`, mentions: batch.map(p => p.id) });
      }
      return;
    } catch { return say('Could not tag members; check group permissions.'); }
  }

  if (cmd === '!docinfo' || cmd === '.docinfo') {
    const media = quotedMedia(m);
    if (media?.type !== 'document') return say('Reply to a document with !docinfo.');
    const d = media.message.documentMessage;
    return say(`📄 ${d.fileName || 'Unnamed file'}\nMIME: ${d.mimetype || 'unknown'}\nSize: ${d.fileLength || 'unknown'} bytes`);
  }

  const media = quotedMedia(m);
  const hasCaptionMedia = m.message?.imageMessage || m.message?.videoMessage || m.message?.audioMessage || m.message?.documentMessage;
  const sourceMedia = media || (hasCaptionMedia ? { type: m.message.imageMessage ? 'image' : m.message.videoMessage ? 'video' : m.message.audioMessage ? 'audio' : 'document', message: m.message } : null);
  if (['!sticker', '.sticker', '!compress', '.compress', '!enhance', '.enhance'].includes(cmd)) {
    if (!sourceMedia || sourceMedia.type !== 'image') return say('Send or reply to an image with this command.');
    const buffer = media ? await getQuotedBuffer(sock, m) : await downloadMediaMessage(m, 'buffer', {}, { logger: undefined, reuploadRequest: sock.updateMediaMessage });
    if (cmd.includes('sticker')) {
      const webp = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
      return sock.sendMessage(from, { sticker: webp }, { quoted: m });
    }
    let img = sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    if (cmd.includes('enhance')) img = img.normalize().sharpen();
    const output = await img.jpeg({ quality: cmd.includes('compress') ? 65 : 85 }).toBuffer();
    return sock.sendMessage(from, { image: output, caption: cmd.includes('compress') ? '🗜️ Compressed image' : '✨ Enhanced image' }, { quoted: m });
  }
  if (cmd === '!gif' || cmd === '.gif' || cmd === '!mp3' || cmd === '.mp3') {
    if (!sourceMedia || (cmd.includes('gif') ? sourceMedia.type !== 'video' : !['audio', 'video'].includes(sourceMedia.type))) return say(cmd.includes('gif') ? 'Reply to a video with !gif.' : 'Reply to audio/video with !mp3. FFmpeg must be installed.');
    const input = media ? await getQuotedBuffer(sock, m) : await downloadMediaMessage(m, 'buffer', {}, { logger: undefined, reuploadRequest: sock.updateMediaMessage });
    const dir = path.join(__dirname, '.tmp'); fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, `${Date.now()}-input`); const out = path.join(dir, `${Date.now()}-${cmd.includes('gif') ? 'out.gif' : 'out.mp3'}`);
    try {
      fs.writeFileSync(src, input);
      await new Promise((resolve, reject) => {
        let proc = ffmpeg(src);
        if (cmd.includes('gif')) proc = proc.noAudio().fps(12).size('480x?').duration(10).outputOptions('-loop 0').format('gif');
        else proc = proc.noVideo().audioCodec('libmp3lame').audioBitrate(128).format('mp3');
        proc.on('end', resolve).on('error', reject).save(out);
      });
      const output = fs.readFileSync(out);
      return cmd.includes('gif') ? await sock.sendMessage(from, { video: output, gifPlayback: true, caption: '🎞️ Converted GIF' }, { quoted: m }) : await sock.sendMessage(from, { audio: output, mimetype: 'audio/mpeg', fileName: 'converted.mp3' }, { quoted: m });
    } catch { return say('Conversion failed. Ensure FFmpeg is installed and the media is valid.'); }
    finally { for (const f of [src, out]) try { fs.unlinkSync(f); } catch {} }
  }

  const lower = text.toLowerCase();
  for (const [keyword, reply] of Object.entries(db.keywordReplies || {})) {
    if (keyword && lower.includes(keyword.toLowerCase())) return say(String(reply).slice(0, 1000));
  }
  if (isGroup && /\b(good morning|morning)\b/i.test(text)) return say('🌅 Good morning!');
  if (isGroup && /\b(good night|goodnight)\b/i.test(text)) return say('🌙 Good night!');
  if (/\b(hi|hello|hey)\b/i.test(text) && !text.startsWith('!')) return say(`👋 Hello! Send !menu to see ${settings.botName} commands.`);
};

module.exports.onGroupParticipantsUpdate = async (sock, update) => {
  if (update.action !== 'add') return;
  const members = (update.participants || []).map(jid => `@${jid.split('@')[0]}`);
  if (!members.length) return;
  await sock.sendMessage(update.id, { text: `👻 A new signal entered the group. Welcome ${members.join(' ')}`, mentions: update.participants }).catch(() => {});
};
