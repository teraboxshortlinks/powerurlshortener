const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const path = require('path');
const app = express();

// --- Express Server for uptime check ---
app.get('/', (req, res) => {
  res.send('✅ Bot is running...');
});

const port = 8080;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// --- Load Telegram Bot Token from Environment Variable ---
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN environment variable not set.');
  process.exit(1);
}

// --- Initialize Telegram Bot ---
const bot = new TelegramBot(botToken, { polling: true });

// --- Database Setup ---
const dbPath = path.join(__dirname, 'src', 'database.json');
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath));
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '{}');

// --- Token Storage Functions ---
function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

function saveUserToken(chatId, token) {
  const dbData = getDatabaseData();
  dbData[chatId] = token;
  fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
}

function getUserToken(chatId) {
  const dbData = getDatabaseData();
  return dbData[chatId];
}

// --- URL Detection & Replacement ---
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

// --- Shorten Single URL ---
async function shortenUrl(chatId, url) {
  const userToken = getUserToken(chatId);
  if (!userToken) {
    bot.sendMessage(chatId, '⚠️ You have not set your API token.\nPlease use:\n/api YOUR_API_TOKEN');
    return null;
  }
  try {
    const apiUrl = `https://powerurlshortener.link/api?api=${userToken}&url=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl);
    return response.data.shortenedUrl || response.data.shortened || response.data.short || url;
  } catch (error) {
    console.error('Shorten URL Error:', error.message);
    return url;
  }
}

// --- Shorten Multiple URLs ---
async function shortenMultipleLinks(chatId, links) {
  const shortenedLinks = [];
  for (const link of links) {
    const shortened = await shortenUrl(chatId, link);
    shortenedLinks.push(shortened || link);
  }
  return shortenedLinks;
}

// --- Bot Commands & Message Handlers ---

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.fullrname || 'User';

  const welcomeMessage = `😇 Hello, ${fullname}!\n\n`
    + 'Welcome to the powerurlshortener.link URL Shortener Bot!\n'
    + 'You can use this bot to shorten URLs using the powerurlshortener.link api service.\n\n'
    + 'To shorten a URL, just type or paste the URL directly in the chat, and the bot will provide you with the shortened URL.\n\n'
    + 'If you haven\'t set your powerurlshortener API token yet, use the command:\n/api YOUR_powerurlshortener_API_TOKEN\n\n'
    + 'How To Use Me 👇👇 \n\n powerurlshortener.link & Complete Your Registration.\n\n'
  + '✅2. Then Copy Your API Key from here https://powerurlshortener.link/member/tools/api Copy Your API Only. \n\n'
  + '✅3. Then add your API using command /api \n\n' 
  + 'Example: /api c49399f821fc020161bc2a31475ec59f35ae5b4\n\n'
  + '⚠️ You must have to send link with https:// or http://\n\n'
  + 'Made with ❤️ By: https://t.me/powerurlshortener';
  + '**Now, go ahead and try it out!**';

  
  bot.sendMessage(chatId, welcomeMessage);
});

// /api command
bot.onText(/\/api (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const newToken = match[1].trim();
  const oldToken = getUserToken(chatId);

  if (oldToken && oldToken === newToken) {
    bot.sendMessage(chatId, `ℹ️ This API token is already set.`);
    return;
  }

  saveUserToken(chatId, newToken);
  bot.sendMessage(chatId, `✅ Your API token has been saved successfully.`);
});

// Handle general messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Ignore bot commands
  if (msg.text && (msg.text.startsWith('/api') || msg.text.startsWith('/start'))) return;

  const isForwarded = msg.forward_from || msg.forward_from_chat;

  // Case 1: Forwarded photo with caption
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);

    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);
      const updatedCaption = replaceLinksInText(caption, links, shortenedLinks);
      const photoFileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, photoFileId, {
        caption: updatedCaption,
        reply_to_message_id: msg.message_id
      });
    } else {
      const photoFileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, photoFileId, {
        caption: caption,
        reply_to_message_id: msg.message_id
      });
    }
    return;
  }

  // Case 2: Forwarded text only
  if (isForwarded && msg.text) {
    const links = extractLinks(msg.text);
    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);
      const updatedText = replaceLinksInText(msg.text, links, shortenedLinks);
      await bot.sendMessage(chatId, updatedText, { reply_to_message_id: msg.message_id });
    } else {
      await bot.sendMessage(chatId, msg.text, { reply_to_message_id: msg.message_id });
    }
    return;
  }

  // Case 3: Normal message (text or caption)
  const text = msg.text || msg.caption || '';
  const links = extractLinks(text);

  if (links.length > 0) {
    const shortenedLinks = await shortenMultipleLinks(chatId, links);
    const updatedText = replaceLinksInText(text, links, shortenedLinks);

    if (msg.photo) {
      const photoFileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, photoFileId, {
        caption: updatedText,
        reply_to_message_id: msg.message_id
      });
    } else {
      await bot.sendMessage(chatId, updatedText, {
        reply_to_message_id: msg.message_id,
        disable_web_page_preview: true
      });
    }
  }
});
