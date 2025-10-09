// Telegram URL Shortener Bot
// This bot shortens URLs using the PowerURLShortener.link API,
// allows custom headers/footers, manages API tokens per user,
// checks balance, and can auto-post to a specified Telegram channel.

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const path = require('path');
const app = express();

// --- Web Server Setup ---
app.get('/', (req, res) => {
  res.send('Hello World! Bot is running.');
});
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// --- Telegram Bot Setup ---
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set.');
  process.exit(1);
}
const bot = new TelegramBot(botToken, { polling: true });

bot.setMyCommands([
  { command: 'start', description: 'Show welcome message and instructions' },
  { command: 'api', description: 'Set your PowerURLShortener API token (/api YOUR_TOKEN)' },
  { command: 'add_header', description: 'Set custom text to appear before shortened content' },
  { command: 'add_footer', description: 'Set custom text to appear after shortened content' },
  { command: 'set_channel', description: 'Set a channel for auto-posting (ID, @username, or link)' },
  { command: 'remove_channel', description: 'Disable auto-posting to a channel' },
  { command: 'balance', description: 'Check your balance and clicks on PowerURLShortener' },
  { command: 'my_channel', description: 'Show your currently set auto-post channel' }
]);

// --- Database Configuration and Functions ---
const dbPath = path.join(__dirname, 'src', 'database.json');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '{}');
}

function getDatabaseData() {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error.message);
    return {};
  }
}

function saveToDatabase(chatId, key, value) {
  const db = getDatabaseData();
  if (!db[chatId]) {
    db[chatId] = {};
  }
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

// --- Header/Footer and Link Processing Utilities ---
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footer = getFromDatabase(chatId, 'footer') || '';
  return {
    header: `${header ? header + '\n\n' : ''}`,
    footer: `${footer ? '\n' + footer : ''}\n\n\n\n✅ Powered by PowerURLShortener.link`
  };
}

function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

async function replaceLinksInText(originalText, originalLinks, shortenedLinks) {
  let replacedText = originalText;
  originalLinks.forEach((link, index) => {
    if (shortenedLinks[index]) {
      const regex = new RegExp(escapeRegExp(link), 'g');
      replacedText = replacedText.replace(regex, shortenedLinks[index]);
    }
  });
  return replacedText;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) return null;
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    console.error(`Error shortening URL "${url}":`, err.message);
    return url;
  }
}

async function shortenMultipleLinks(chatId, links) {
  const promises = links.map(link => shortenUrl(chatId, link));
  return await Promise.all(promises);
}

// --- Telegram Message Sending Utility ---
async function sendTelegramMessage(chatId, type, content, options = {}) {
  try {
    if (!chatId) return;
    switch (type) {
      case 'text': await bot.sendMessage(chatId, content, options); break;
      case 'photo': await bot.sendPhoto(chatId, content, options); break;
      case 'video': await bot.sendVideo(chatId, content, options); break;
      case 'mediaGroup': await bot.sendMediaGroup(chatId, content, options); break;
      default: console.warn(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error(`Failed to send ${type} to chat ID ${chatId}:`, error.message);
    if (options.isUserChat && error.response?.body?.description.includes('chat not found')) {
      await bot.sendMessage(chatId, "⚠️ Sorry! I couldn't send the message to the specified channel. Please check the ID/username and my permissions.");
    }
  }
}

// --- Bot Command Handlers ---
bot.onText(/\/start/, (msg) => {
    const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const welcomeText = `😇 *Welcome, ${name}!*

🔗 *PowerURLShortener Bot* helps you shorten any valid URL easily using the [powerurlshortener.link](https://powerurlshortener.link) API service.

To shorten a URL, just send it directly in the chat — the bot will return a shortened version.

---

📌 *How to Use Me:*
1. Register at [powerurlshortener.link](https://powerurlshortener.link)
2. Get your API key from:
   👉 [https://powerurlshortener.link/member/tools/api](https://powerurlshortener.link/member/tools/api)
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
➕ \`/remove_channel\` — Remove auto-post channel
➕ \`/my_channel\` — Show my current auto-post channel

---

🔗 *Made with ❤️ by:* [PowerURLShortener](https://t.me/powerurlshortener)
👨‍💻 *Created by:* [@namenainai](https://t.me/namenainai)`;
    sendTelegramMessage(msg.chat.id, 'text', welcomeText, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/api (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'token', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.', { isUserChat: true });
});

bot.onText(/\/add_header (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'header', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ Header saved.', { isUserChat: true });
});

bot.onText(/\/add_footer (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'footer', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ Footer saved.', { isUserChat: true });
});

bot.onText(/\/set_channel (.+)/, (msg, match) => {
  let inputChannel = match[1].trim();
  const telegramLinkRegex = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+-]+)/i;
  const matchLink = inputChannel.match(telegramLinkRegex);
  if (matchLink && matchLink[1]) {
    const extractedPart = matchLink[1];
    inputChannel = extractedPart.startsWith('+') ? extractedPart : `@${extractedPart}`;
  }
  if (!inputChannel.startsWith('-100') && !inputChannel.startsWith('@') && !inputChannel.startsWith('+')) {
    sendTelegramMessage(msg.chat.id, 'text', '⚠️ Please provide a valid channel ID, @username, or a Telegram channel invite link.', { isUserChat: true });
    return;
  }
  saveToDatabase(msg.chat.id, 'channel', inputChannel);
  sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set to: \`${inputChannel}\`. Please ensure I am an **administrator** in this channel.`, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/remove_channel/, (msg) => {
  const removed = deleteFromDatabase(msg.chat.id, 'channel');
  sendTelegramMessage(msg.chat.id, 'text', removed ? '✅ Channel removed.' : 'ℹ️ No channel was set.', { isUserChat: true });
});

bot.onText(/\/my_channel/, (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel');
  sendTelegramMessage(msg.chat.id, 'text', channel ? `📢 Your current auto-post channel: \`${channel}\`` : 'No auto-post channel is set.', { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) {
    return sendTelegramMessage(msg.chat.id, 'text', '⚠️ Your API token is not set. Use `/api YOUR_API_TOKEN`.', { isUserChat: true });
  }
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    if (res.data?.status === 'success') {
      sendTelegramMessage(msg.chat.id, 'text', `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`, { isUserChat: true });
    } else {
      sendTelegramMessage(msg.chat.id, 'text', `❌ Failed to fetch balance: ${res.data?.message || 'Invalid API token.'}`, { isUserChat: true });
    }
  } catch (error) {
    console.error(`Error fetching balance for chat ${msg.chat.id}:`, error.message);
    sendTelegramMessage(msg.chat.id, 'text', '🚫 Failed to fetch balance. The API might be down.', { isUserChat: true });
  }
});

// --- Main Message Handler ---
const mediaGroups = {};
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Ignore commands
  if (msg.text && msg.text.startsWith('/')) return;

  // Check for API token
  const userApiToken = getFromDatabase(chatId, 'token');
  if (!userApiToken) {
    sendTelegramMessage(chatId, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN` to use the bot.', { parse_mode: 'Markdown', isUserChat: true });
    return;
  }

  // --- Handle Media Groups ---
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;
    if (!mediaGroups[groupId]) {
      mediaGroups[groupId] = [];
      setTimeout(async () => {
        const group = mediaGroups[groupId];
        delete mediaGroups[groupId];
        if (!group?.length) return;

        let originalCaption = group.find(m => m.caption)?.caption || '';
        let processedCaption = originalCaption;

        const links = extractLinks(originalCaption);
        if (links.length > 0) {
          const shortenedLinks = await shortenMultipleLinks(chatId, links);
          processedCaption = await replaceLinksInText(originalCaption, links, shortenedLinks);
        }

        const { header, footer } = getUserHeaderFooter(chatId);
        const finalCaption = `${header}${processedCaption}${footer}`;

        const media = group.map((m, i) => ({
          type: m.photo ? 'photo' : 'video',
          media: m.photo ? m.photo[m.photo.length - 1].file_id : m.video.file_id,
          caption: i === 0 ? finalCaption : undefined
        }));

        if (media.length > 0) {
          await sendTelegramMessage(chatId, 'mediaGroup', media, { reply_to_message_id: group[0].message_id, isUserChat: true });
          const autoPostChannel = getFromDatabase(chatId, 'channel');
          if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'mediaGroup', media);
        }
      }, 500);
    }
    mediaGroups[groupId].push(msg);
    return;
  }
  
  // --- Handle All Other Messages (Text, Photo, Video) ---
  
  // 1. Get the original content (text or caption)
  let originalContent = msg.text || msg.caption || '';
  
  // 2. Process links ONLY in the original content
  let processedContent = originalContent;
  const links = extractLinks(originalContent);
  if (links.length > 0) {
    const shortenedLinks = await shortenMultipleLinks(chatId, links);
    processedContent = await replaceLinksInText(originalContent, links, shortenedLinks);
  }
  
  // 3. Get header and footer, then combine everything
  // This is done AFTER link shortening is complete.
  const { header, footer } = getUserHeaderFooter(chatId);
  const finalOutput = `${header}${processedContent}${footer}`;
  
  // 4. Send the final message based on its type
  const autoPostChannel = getFromDatabase(chatId, 'channel');
  
  if (msg.photo) {
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalOutput, reply_to_message_id: msg.message_id, isUserChat: true });
    if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', photoId, { caption: finalOutput });
  } else if (msg.video) {
    const videoId = msg.video.file_id;
    await sendTelegramMessage(chatId, 'video', videoId, { caption: finalOutput, reply_to_message_id: msg.message_id, isUserChat: true });
    if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', videoId, { caption: finalOutput });
  } else if (msg.text) {
    // Only reply to text if there were links or if header/footer adds content
    if (links.length > 0 || finalOutput.trim() !== originalContent.trim()) {
      await sendTelegramMessage(chatId, 'text', finalOutput, { reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalOutput);
    }
  }
});

console.log('Bot is running and listening for messages...')
