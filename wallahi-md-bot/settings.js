module.exports = {
  botName: process.env.BOT_NAME || 'wallahi MD',
  ownerId: process.env.OWNER_ID || '',
  // Use only after adding your own image at menu-bg.jpg. Chat background customization
  // is not available in Telegram/WhatsApp bots; this image is sent with the menu.
  menuImagePath: './menu-bg.jpg',
  antilink: true,
  maxDownloadBytes: 15 * 1024 * 1024,
  maxTagAll: 100,
  tagCooldownMs: 5 * 60 * 1000
};
