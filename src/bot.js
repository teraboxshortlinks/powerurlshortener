// Telegram URL Shortener Bot
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const path = require('path');
const app = express();

// --- Express server (for uptime check)
app.get('/', (req, res) => {
  res.send('Hello World!');
});
const port = 8080;
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));

// --- Telegram Bot Token from Environment Variable
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}
const bot = new TelegramBot(botToken, { polling: true });

// --- Commands
bot.setMyCommands([
  { command: 'start', description: 'Show welcome message' },
  { command: 'api', description: 'Set your API token (/api YOUR_TOKEN)' },
  { command: 'add_header', description: 'Set custom header text' },
  { command: 'add_footer', description: 'Set custom footer text' },
  { command: 'set_channel', description: 'Set sent link channel' },
  { command: 'remove_channel', description: 'Remove channel' },
  { command: 'balance', description: 'My balance' },
  { command: 'my_channel', description: 'My channel' }
]);

// --- Database
const dbPath = path.join(__dirname, 'src', 'database.json');
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath));
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '{}');

function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return {};
  }
}
function saveToDatabase(chatId, key, value) {
  const db = getDatabaseData();
  if (!db[chatId]) db[chatId] = {};
  db[chatId][key] = value;
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}
function getFromDatabase(chatId, key) {
  const db = getDatabaseData();
  return db[chatId]?.[key];
}
function deleteFromDatabase(chatId, key) {
  const db = getDatabaseData();
  if (db[chatId] && db[chatId][key]) {
    delete db[chatId][key];
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    return true;
  }
  return false;
}

// --- Header/Footer
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footer = getFromDatabase(chatId, 'footer') || '';
  return {
    header: header ? `🔗 Links:\n${header}\n` : '',
    footer: `\n${footer || ''}\n✅ Powered by PowerURLShortener.link`
  };
}

// --- Link Handling
function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return [...text.matchAll(urlRegex)].map(match => match[0]);
}
function replaceLinks(text, original, shortened) {
  let updated = text;
  original.forEach((link, idx) => {
    updated = updated.replace(link, shortened[idx]);
  });
  return updated;
}
async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) {
    bot.sendMessage(chatId, '⚠️ Please set your API token using:\n/api YOUR_API_TOKEN');
    return null;
  }
  try {
    const apiUrl = `https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiUrl);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    console.error('Shorten URL Error:', err.message);
    return url;
  }
}
async function shortenMultipleLinks(chatId, links) {
  const results = [];
  for (const link of links) {
    const short = await shortenUrl(chatId, link);
    results.push(short || link);
  }
  return results;
}

// --- Commands
bot.onText(/\/start/, (msg) => {
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  const welcome = `😇 Welcome Hello Dear, ${name}!

🔗 PowerURLShortener Bot is here to help you shorten any valid URL easily.

To shorten a URL, just type or paste the URL directly.

If you haven't set your API token yet:
/api YOUR_powerurlshortener_API_TOKEN

📌 How To Use:
1. Go to powerurlshortener.link & register.
2. Copy your API Key from:
   https://powerurlshortener.link/member/tools/api
3. Set API: /api <your_api>

✅ Example:
   /api f80e3447043b...

🧩 Commands:
➕ /api — Set your API token
➕ /add_header — Add a custom header
➕ /add_footer — Add a custom footer
➕ /balance — Check your balance
➕ /set_channel — Set auto-post channel

🔗 Made with ❤️ by: https://t.me/powerurlshortener`;
  bot.sendMessage(msg.chat.id, welcome);
});

bot.onText(/\/api (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'token', match[1].trim());
  bot.sendMessage(msg.chat.id, '✅ Your API token has been saved.');
});
bot.onText(/\/add_header (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'header', match[1].trim());
  bot.sendMessage(msg.chat.id, '✅ Header saved.');
});
bot.onText(/\/add_footer (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'footer', match[1].trim());
  bot.sendMessage(msg.chat.id, '✅ Footer saved.');
});
bot.onText(/\/set_channel (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'channel', match[1].trim());
  bot.sendMessage(msg.chat.id, '✅ Channel set.');
});
bot.onText(/\/remove_channel/, (msg) => {
  const removed = deleteFromDatabase(msg.chat.id, 'channel');
  bot.sendMessage(msg.chat.id, removed ? '✅ Channel removed.' : 'ℹ️ No channel was set.');
});
bot.onText(/\/my_channel/, (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel');
  bot.sendMessage(msg.chat.id, channel ? `📢 Current channel: ${channel}` : 'No channel set.\nUse /set_channel @yourchannel');
});
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const token = getFromDatabase(chatId, 'token');
  if (!token) return bot.sendMessage(chatId, '⚠️ Please set your API token first with /api YOUR_TOKEN');

  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    const d = res.data;
    if (d.status === 'success') {
      const text = `💰 *Your Balance Info*\n\n` +
        `🔹 Balance: $${d.balance || 'N/A'}\n` +
        `👁️ Clicks: *${d.clicks || 'N/A'}*\n` +
        `📄 Shortened URLs: *${d.shortened_urls || 'N/A'}*`;
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '❌ Invalid API token or failed to fetch.');
    }
  } catch (err) {
    bot.sendMessage(chatId, '🚫 Error fetching balance. Try later.');
  }
});

// --- Media Group Handling
const mediaGroups = {};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && (msg.text.startsWith('/api') || msg.text.startsWith('/start'))) return;

  const isForwarded = msg.forward_from || msg.forward_from_chat;
  const { header, footer } = getUserHeaderFooter(chatId);

  // Media Group
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;
    if (!mediaGroups[groupId]) {
      mediaGroups[groupId] = [];
      setTimeout(async () => {
        const group = mediaGroups[groupId];
        delete mediaGroups[groupId];
        if (!group?.length) return;

        const caption = group.find(m => m.caption)?.caption || '';
        const links = extractLinks(caption);
        let updatedCaption = caption;
        if (links.length > 0) {
          const shortened = await shortenMultipleLinks(chatId, links);
          updatedCaption = replaceLinks(caption, links, shortened);
        }
        const finalCaption = `${header}${updatedCaption}${footer}`;
        const media = group.map((m, i) => {
          if (m.photo) {
            const fileId = m.photo[m.photo.length - 1].file_id;
            return { type: 'photo', media: fileId, caption: i === 0 ? finalCaption : undefined };
          } else if (m.video) {
            return { type: 'video', media: m.video.file_id, caption: i === 0 ? finalCaption : undefined };
          }
        });
        await bot.sendMediaGroup(chatId, media, { reply_to_message_id: group[0].message_id });
      }, 500);
    }
    mediaGroups[groupId].push(msg);
    return;
  }

  // Forwarded Photo
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinks(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    return bot.sendPhoto(chatId, msg.photo[msg.photo.length - 1].file_id, {
      caption: finalCaption,
      reply_to_message_id: msg.message_id
    });
  }

  // Forwarded Video
  if (isForwarded && msg.video) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinks(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    return bot.sendVideo(chatId, msg.video.file_id, {
      caption: finalCaption,
      reply_to_message_id: msg.message_id
    });
  }

  // Normal message/photo/video
  const text = msg.text || msg.caption || '';
  const links = extractLinks(text);
  if (links.length > 0) {
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinks(text, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    if (msg.photo) {
      return bot.sendPhoto(chatId, msg.photo[msg.photo.length - 1].file_id, {
        caption: finalCaption,
        reply_to_message_id: msg.message_id
      });
    }
    if (msg.video) {
      return bot.sendVideo(chatId, msg.video.file_id, {
        caption: finalCaption,
        reply_to_message_id: msg.message_id
      });
    }
    return bot.sendMessage(chatId, finalCaption, { reply_to_message_id: msg.message_id });
  }
});
