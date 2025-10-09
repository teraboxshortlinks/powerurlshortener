// Telegram URL Shortener Bot - FINAL VERIFICATION VERSION

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const path = require('path');
const app = express();

// --- Web Server Setup ---
app.get('/', (req, res) => { res.send('Hello World! Bot is running.'); });
const port = process.env.PORT || 8080;
app.listen(port, () => { console.log(`Server running on port ${port}`); });

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
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '{}');

function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
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
  }
}

// --- Utilities ---
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footerText = getFromDatabase(chatId, 'footer') || '';
  
  // ★★★ যাচাইকরণ পরিবর্তনটি এখানে করা হয়েছে ★★★
  const finalFooter = `${footerText ? '\n' + footerText : ''}\n\n\n\n✅ NEW CODE v5 ✅ Powered by PowerURLShortener.link`;

  return {
    header: `${header ? header + '\n\n' : ''}`,
    footer: finalFooter
  };
}

function extractLinks(text) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return text.match(urlRegex) || [];
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) return url;
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) { return url; }
}
async function shortenMultipleLinks(chatId, links) {
  return Promise.all(links.map(link => shortenUrl(chatId, link)));
}
async function sendTelegramMessage(chatId, type, content, options = {}) {
  try {
    if (!chatId) return;
    const methods = { text: bot.sendMessage, photo: bot.sendPhoto, video: bot.sendVideo, mediaGroup: bot.sendMediaGroup };
    await methods[type].call(bot, chatId, content, options);
  } catch (error) { console.error(`Failed to send message:`, error.message); }
}

// --- Command Handlers ---
bot.onText(/\/(start|api|add_header|add_footer|set_channel|remove_channel|my_channel|balance)/, (msg) => {
    // This will handle all command messages and prevent them from being processed by the main handler.
});
// (Your specific command handlers for saving data remain the same)
bot.onText(/\/api (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'token', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.'); });
bot.onText(/\/add_header (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'header', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ Header saved.'); });
bot.onText(/\/add_footer (.+)/, (msg, match) => { saveToDatabase(msg.chat.id, 'footer', match[1].trim()); sendTelegramMessage(msg.chat.id, 'text', '✅ Footer saved.'); });
// Add other command handlers here...

// --- Main Message Handler ---
const mediaGroups = {};
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if ((msg.text && msg.text.startsWith('/')) || !msg) return;
    if (!getFromDatabase(chatId, 'token')) return sendTelegramMessage(chatId, 'text', '⚠️ API token not set.');

    // This function now correctly separates user content from bot additions.
    const processContent = async (originalContent) => {
        let processedContent = originalContent;
        const linksToShorten = extractLinks(originalContent);
        
        if (linksToShorten.length > 0) {
            const shortenedLinks = await shortenMultipleLinks(chatId, linksToShorten);
            processedContent = await replaceLinksInText(originalContent, linksToShorten, shortenedLinks);
        }
        
        const { header, footer } = getUserHeaderFooter(chatId);
        return `${header}${processedContent}${footer}`;
    };

    const autoPostChannel = getFromDatabase(chatId, 'channel');
    const originalContent = msg.text || msg.caption || '';
    const finalOutput = await processContent(originalContent);
    
    // Logic to send the message
    if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await sendTelegramMessage(chatId, 'photo', fileId, { caption: finalOutput, reply_to_message_id: msg.message_id });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', fileId, { caption: finalOutput });
    } else if (msg.video) {
        const fileId = msg.video.file_id;
        await sendTelegramMessage(chatId, 'video', fileId, { caption: finalOutput, reply_to_message_id: msg.message_id });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', fileId, { caption: finalOutput });
    } else if (msg.text) {
        if (finalOutput.trim() !== originalContent.trim()) {
            await sendTelegramMessage(chatId, 'text', finalOutput, { reply_to_message_id: msg.message_id });
            if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalOutput);
        }
    }
});

console.log('Bot is running and listening for messages...');
```
