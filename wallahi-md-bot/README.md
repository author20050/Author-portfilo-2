# wallahi MD bot

This folder adds a Node.js Telegram/WhatsApp bot to the portfolio repository. The menu uses ordinary text for WhatsApp and inline Telegram buttons. Tic-Tac-Toe is played against the bot with `!ttt` and `!ttt move 1` through `!ttt move 9`.

## Setup

1. Install Node.js 20 or newer. Install FFmpeg on the host if you want `!gif` and `!mp3` conversions.
2. Copy `.env.example` to `.env`; enter a **newly generated** Telegram bot token and your Telegram owner ID. Do not commit `.env`.
3. Run `npm install` and `npm start` from this directory.
4. Open the Telegram bot and send `/start`. Pair WhatsApp from the configured owner account with `.pair <international-number>`.
5. To show the supplied artwork with the menu, save the image as `menu-bg.jpg` in this directory. Bots cannot set a true chat wallpaper; this image is sent as the menu photo. The original image was not available as a repository file during this upload.

## Commands

- `!help`, `!menu`, `!ping`, `!about`, `!stats`
- `!ttt` and `!ttt move 1-9` — single-player Tic-Tac-Toe with an unbeatable minimax opponent
- `!tagall` — group admins only; bot must also be admin; 100-mention cap and cooldown
- `!qr <text>` and `!link <URL>`
- Reply to an image with `!sticker`, `!compress`, or `!enhance`
- Reply to a video with `!gif`; reply to audio/video with `!mp3` (FFmpeg required)
- Reply to a document with `!docinfo`; reply to a message with `!quote <text>`
- Owner-only: `!schedule <minutes> <message>` (timer is lost if the process restarts), `!read on|off`

Keyword replies can be configured by adding lowercase keyword-to-reply entries under `keywordReplies` in `database.json`. Incoming group messages containing `good morning`, `good night`, or a simple greeting receive a reply. New group participants receive a welcome.

## Safety and limitations

- The token previously posted in chat should be revoked in BotFather. Put only its replacement in the local `.env` file.
- Pairing is restricted to the configured Telegram owner; do not make session files public. Never upload `.env`, `session/`, or real credentials.
- `!tagall` can notify many people; use sparingly. Anti-link removes invite links only if the bot's admin status can be confirmed.
- `!link` reports parsed URL components; it does not fetch arbitrary webpages. There is deliberately no arbitrary-URL downloader.
- This project sends replies only when its commands/keyword triggers match; it is not an autonomous bulk-messaging tool. Read receipts can be disabled where supported.
- Test in a private group before using it broadly. Baileys is an unofficial WhatsApp Web client and may change independently of this project.
