// Telegram URL Shortener Bot - FINAL DEBUG VERSION

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
  { command: 'start', description: 'Show welcome message' },
  { command: 'api', description: 'Set your API token' },
  { command: 'add_header', description: 'Set custom header' },
  { command: 'add_footer', description: 'Set custom footer' },
  { command: 'set_channel', description: 'Set auto-post channel' },
  { command: 'remove_channel', description: 'Remove auto-post channel' },
  { command: 'balance', description: 'Check your balance' },
  { command: 'my_channel', description: 'Show current channel' }
]);

// --- Database Configuration ---
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
  } catch (error) { return {}; }
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
  if (db[chatId]?.[key]) {
    delete db[chatId][key];
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    return true;
  }
  return false;
}

// --- Utilities ---
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footer = getFromDatabase(chatId, 'footer') || '';
  return {
    header: `${header ? header + '\n\n' : ''}`,
    footer: `${footer ? '\n' + footer : ''}\n\n\n\n✅ Powered by PowerURLShortener.link`
  };
}

function extractLinks(text) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return text.match(urlRegex) || [];
}

async function replaceLinksInText(text, original, shortened) {
  let replacedText = text;
  original.forEach((link, i) => {
    if (shortened[i] && shortened[i] !== link) {
      replacedText = replacedText.replace(new RegExp(escapeRegExp(link), 'g'), shortened[i]);
    }
  });
  return replacedText;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) return url;
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    return url;
  }
}

async function shortenMultipleLinks(chatId, links) {
  return Promise.all(links.map(link => shortenUrl(chatId, link)));
}

async function sendTelegramMessage(chatId, type, content, options = {}) {
  try {
    if (!chatId) return;
    const methods = {
      text: bot.sendMessage,
      photo: bot.sendPhoto,
      video: bot.sendVideo,
      mediaGroup: bot.sendMediaGroup
    };
    await methods[type].call(bot, chatId, content, options);
  } catch (error) {
    console.error(`Failed to send ${type} to chat ID ${chatId}:`, error.message);
  }
}

// --- Command Handlers ( সংক্ষিপ্ত করা হয়েছে ) ---
bot.onText(/\/start/, (msg) => sendTelegramMessage(msg.chat.id, 'text', `Welcome...`));
bot.onText(/\/api (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'token', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.'); });
bot.onText(/\/add_header (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'header', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ Header saved.'); });
bot.onText(/\/add_footer (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'footer', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ Footer saved.'); });
bot.onText(/\/set_channel (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'channel', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set.`); });
bot.onText(/\/remove_channel/, (msg) => { deleteFromDatabase(msg.chat.id, 'channel'); sendTelegramMessage(msg.chat.id, 'text', '✅ Channel removed.'); });
bot.onText(/\/my_channel/, (msg) => sendTelegramMessage(msg.chat.id, 'text', `Current channel: ${getFromDatabase(msg.chat.id, 'channel') || 'Not set'}`));
bot.onText(/\/balance/, async (msg) => { /* Balance check logic */ });

// --- Main Message Handler ---
const mediaGroups = {};
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return;
    if (!getFromDatabase(chatId, 'token')) return sendTelegramMessage(chatId, 'text', '⚠️ API token not set.');

    const processContent = async (originalContent) => {
        const linksToShorten = extractLinks(originalContent);
        let processedContent = originalContent;
        if (linksToShorten.length > 0) {
            const shortenedLinks = await shortenMultipleLinks(chatId, linksToShorten);
            processedContent = await replaceLinksInText(originalContent, linksToShorten, shortenedLinks);
        }
        const { header, footer } = getUserHeaderFooter(chatId);

        // =================================================================
        //               ★★★ ডিবাগিং কোড ★★★
        // =================================================================
        console.log("\n\n--- BOT DEBUG LOG ---");
        console.log("STEP 1: Original content from user ->", originalContent);
        console.log("STEP 2: Content after shortening links ->", processedContent);
        console.log("STEP 3: Footer text being added ->", footer);
        const finalResult = `${header}${processedContent}${footer}`;
        console.log("STEP 4: Final output to be sent ->", finalResult);
        console.log("--- END OF LOG ---\n\n");
        // =================================================================

        return finalResult;
    };

    const autoPostChannel = getFromDatabase(chatId, 'channel');
    const handleAndSend = async (type, fileId, originalContent) => {
        const finalOutput = await processContent(originalContent);
        await sendTelegramMessage(chatId, type, fileId, { caption: finalOutput, reply_to_message_id: msg.message_id });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, type, fileId, { caption: finalOutput });
    };

    if (msg.media_group_id) { /* Media group logic */ return; }

    const originalContent = msg.text || msg.caption || '';

    if (msg.photo) {
        await handleAndSend('photo', msg.photo[msg.photo.length - 1].file_id, originalContent);
    } else if (msg.video) {
        await handleAndSend('video', msg.video.file_id, originalContent);
    } else if (msg.text) {
        const finalOutput = await processContent(originalContent);
        if (finalOutput.trim() !== originalContent.trim()) {
            await sendTelegramMessage(chatId, 'text', finalOutput, { reply_to_message_id: msg.message_id });
            if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalOutput);
        }
    }
});

console.log('Bot is running and listening for messages...');
```
