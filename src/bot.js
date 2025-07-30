// Telegram URL Shortener Bot
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const path = require('path');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});
const port = 8080;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}
const bot = new TelegramBot(botToken, { polling: true });

bot.setMyCommands([
  { command: 'start', description: 'Show welcome message' },
  { command: 'api', description: 'Set your API token (/api YOUR_TOKEN)' },
  { command: 'add_header', description: 'Set custom header text' },
  { command: 'add_footer', description: 'Set custom footer text' },
  { command: 'set_channel', description: 'Set auto-post channel' },
  { command: 'remove_channel', description: 'Remove channel' },
  { command: 'balance', description: 'My balance' },
  { command: 'my_channel', description: 'My channel' }
]);

// DB
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

// Header/Footer
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footer = getFromDatabase(chatId, 'footer') || '';
  return {
    header: `${header ? header + '\n' : ''}`,
    footer: `${footer ? '\n' + footer : ''}\n✅ Powered by PowerURLShortener.link`
  };
}

function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return [...text.matchAll(urlRegex)].map(match => match[0]);
}

function replaceLinksInText(text, originalLinks, shortenedLinks) {
  let updatedText = text;
  originalLinks.forEach((link, index) => {
    updatedText = updatedText.replace(link, shortenedLinks[index]);
  });
  return updatedText;
}

async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) {
    bot.sendMessage(chatId, '⚠️ Please set your API token using:\n/api YOUR_API_TOKEN');
    return null;
  }
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    return url;
  }
}

async function shortenMultipleLinks(chatId, links) {
  const result = [];
  for (const link of links) {
    const short = await shortenUrl(chatId, link);
    result.push(short || link);
  }
  return result;
}

bot.onText(/\/start/, (msg) => {
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  const text = `😇 *Welcome, ${name}!*

🔗 *PowerURLShortener Bot* helps you shorten any valid URL easily using the [powerurlshortener.link](https://powerurlshortener.link) API service.

To shorten a URL, just send it directly in the chat — the bot will return a shortened version.

---

📌 *How to Use Me:*
1. Register at [powerurlshortener.link](https://powerurlshortener.link)
2. Get your API key from:
   👉 https://powerurlshortener.link/member/tools/api
3. Set it using: \`/api <your_api>\`

✅ *Example:*
\`/api f80e3447043b391084f992de73eb5970e70b0b79\`

⚠️ *Links must start with* \`http://\` or \`https://\`

---

🧩 *Commands:*
➕ \`/api\` — Set your API token  
➕ \`/add_header\` — Add custom header  
➕ \`/add_footer\` — Add custom footer  
➕ \`/balance\` — Check your balance  
➕ \`/set_channel\` — Set auto-post channel

---

🔗 *Made with ❤️ by:* [PowerURLShortener](https://t.me/powerurlshortener)  
👨‍💻 *Created by:* [@namenainai](https://t.me/namenainai)`;

 

  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/api (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'token', match[1].trim());
  bot.sendMessage(msg.chat.id, '✅ API token saved.');
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
  bot.sendMessage(msg.chat.id, channel ? `📢 Your channel: ${channel}` : 'No channel set.');
});
bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) return bot.sendMessage(msg.chat.id, '⚠️ Set API first: /api YOUR_TOKEN');
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    if (res.data.status === 'success') {
      bot.sendMessage(msg.chat.id, `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`);
    } else {
      bot.sendMessage(msg.chat.id, '❌ Invalid API token.');
    }
  } catch {
    bot.sendMessage(msg.chat.id, '🚫 Failed to fetch balance.');
  }
});

// MediaGroup handler
const mediaGroups = {};
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && (msg.text.startsWith('/api') || msg.text.startsWith('/start'))) return;

  const { header, footer } = getUserHeaderFooter(chatId);
  const isForwarded = msg.forward_from || msg.forward_from_chat;
  const channel = getFromDatabase(chatId, 'channel');

  // Handle Media Group
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
          updatedCaption = replaceLinksInText(caption, shortened);
        }

        const finalCaption = `${header}${updatedCaption}${footer}`;
        const media = group.map((m, i) => {
          if (m.photo) {
            return {
              type: 'photo',
              media: m.photo[m.photo.length - 1].file_id,
              caption: i === 0 ? finalCaption : undefined
            };
          } else if (m.video) {
            return {
              type: 'video',
              media: m.video.file_id,
              caption: i === 0 ? finalCaption : undefined
            };
          }
        });

        await bot.sendMediaGroup(chatId, media, { reply_to_message_id: group[0].message_id });
        if (channel) {
          await bot.sendMediaGroup(channel, media);
        }
      }, 500);
    }

    mediaGroups[groupId].push(msg);
    return;
  }

  // Handle forwarded photo
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    await bot.sendPhoto(chatId, photoId, { caption: finalCaption, reply_to_message_id: msg.message_id });
    if (channel) await bot.sendPhoto(channel, photoId, { caption: finalCaption });
    return;
  }

  // Handle forwarded video
  if (isForwarded && msg.video) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    await bot.sendVideo(chatId, msg.video.file_id, { caption: finalCaption, reply_to_message_id: msg.message_id });
    if (channel) await bot.sendVideo(channel, msg.video.file_id, { caption: finalCaption });
    return;
  }

  // Normal message / photo / video
  const content = msg.text || msg.caption || '';
  const links = extractLinks(content);

  if (links.length > 0) {
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = replaceLinksInText(content, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, photoId, { caption: finalCaption, reply_to_message_id: msg.message_id });
      if (channel) await bot.sendPhoto(channel, photoId, { caption: finalCaption });
    } else if (msg.video) {
      await bot.sendVideo(chatId, msg.video.file_id, { caption: finalCaption, reply_to_message_id: msg.message_id });
      if (channel) await bot.sendVideo(channel, msg.video.file_id, { caption: finalCaption });
    } else {
      await bot.sendMessage(chatId, finalCaption, { reply_to_message_id: msg.message_id });
      if (channel) await bot.sendMessage(channel, finalCaption);
    }
  }
});
