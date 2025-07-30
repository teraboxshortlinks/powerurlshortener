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
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// --- Telegram Bot Token from Environment Variable
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable not set');
  process.exit(1);
}

// --- Telegram Bot Instance
const bot = new TelegramBot(botToken, { polling: true });

// --- Database File Setup
const dbPath = path.join(__dirname, 'src', 'database.json');
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath));
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '{}');

// --- Database Functions
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

// --- URL Extract & Replace Functions
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

// --- URL Shortener
async function shortenUrl(chatId, url) {
  const userToken = getUserToken(chatId);
  if (!userToken) {
    bot.sendMessage(chatId, '⚠️ Please set your powerurlshortener.link API token first:\n/api YOUR_TOKEN');
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

async function shortenMultipleLinks(chatId, links) {
  const shortenedLinks = [];
  for (const link of links) {
    const shortened = await shortenUrl(chatId, link);
    shortenedLinks.push(shortened || link);
  }
  return shortenedLinks;
}

// --- Telegram Bot Handlers ---
// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'User';

  const welcomeMessage = `😇 Hello, ${username}!\n\n`
    + 'Welcome to the powerurlshortener.link URL Shortener Bot!\n\n'
    + 'This bot allows you to shorten URLs easily.\n'
    + 'If you haven\'t set your API token yet, use:\n/api YOUR_API_TOKEN\n\n'
    + 'How to use:\n'
    + '1. Register at powerurlshortener.link\n'
    + '2. Copy your API key from: https://powerurlshortener.link/member/tools/api\n'
    + '3. Use the command: /api YOUR_API_TOKEN\n\n'
    + '⚠️ Make sure links start with https:// or http://\n\n'
    + 'Made with ❤️ By: https://t.me/powerurlshortener\n'
    + '**Now, try it out!**';

  bot.sendMessage(chatId, welcomeMessage);
});

// /api command
bot.onText(/\/api (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userToken = match[1].trim();

  saveUserToken(chatId, userToken);
  bot.sendMessage(chatId, `✅ Your API token has been set successfully:\n${userToken}`);
});

// --- Handle All Messages ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Skip command messages
  if (msg.text && (msg.text.startsWith('/api') || msg.text.startsWith('/start'))) return;

  const isForwarded = msg.forward_from || msg.forward_from_chat;

  // --- Case 1: Forwarded Photo + Caption ---
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

  // --- Case 2: Forwarded Text only ---
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

  // --- Case 3: Normal Message (Text + Photo) ---
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
      await bot.sendMessage(chatId, updatedText, { reply_to_message_id: msg.message_id });
    }
  }
});
