module.exports = {
  botName: process.env.BOT_NAME || 'wallahi MD',
  ownerId: process.env.OWNER_ID || '',
  // Bots cannot set a true chat wallpaper; this image is sent with menu messages.
  menuImagePath: 'Screenshot_20261107_001703117.jpg',
  antilink: true,
  maxDownloadBytes: 15 * 1024 * 1024,
  maxTagAll: 100,
  tagCooldownMs: 5 * 60 * 1000
};
