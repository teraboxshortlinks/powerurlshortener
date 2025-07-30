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

// --- Set Telegram Bot Commands for Auto-Suggest Menu
bot.setMyCommands([
  { command: 'start', description: 'Show welcome message' },
  { command: 'api', description: 'Set your API token (/api YOUR_TOKEN)' },
  { command: 'add_header', description: 'Set custom header text' },
  { command: 'add_footer', description: 'Set custom footer text' }
]);

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
  if (!dbData[chatId]) dbData[chatId] = {};
  dbData[chatId].token = token;
  fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
}

function getUserToken(chatId) {
  const dbData = getDatabaseData();
  return dbData[chatId]?.token;
}

function saveUserHeader(chatId, header) {
  const dbData = getDatabaseData();
  if (!dbData[chatId]) dbData[chatId] = {};
  dbData[chatId].header = header;
  fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
}

function saveUserFooter(chatId, footer) {
  const dbData = getDatabaseData();
  if (!dbData[chatId]) dbData[chatId] = {};
  dbData[chatId].footer = footer;
  fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
}

function getUserHeaderFooter(chatId) {
  const dbData = getDatabaseData();
  const customHeader = dbData[chatId]?.header || '';
  const customFooter = dbData[chatId]?.footer || '';

  return {
    header: `🔗 Shortened Links:\n${customHeader ? customHeader + '\n' : ''}`,
    footer: `${customFooter ? '\n' + customFooter : ''}\n✅ Powered by PowerURLShortener.link`
  };
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
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();

  const welcomeMessage = `😇 Welcome Hello Dear, ${fullName}!

  🔗 PowerURLShortener Bot is here to help you shorten any valid URL easily.


       🔗Welcome to the powerurlshortener.link URL Shortener Bot!\n'
      You can use this bot to shorten URLs using the powerurlshortener.link api service.\n\n'
      To shorten a URL, just type or paste the URL directly in the chat, and the bot will provide you with the shortened URL.\n\n'
      If you haven\'t set your powerurlshortener API token yet, use the command:\n/api YOUR_powerurlshortener_API_TOKEN\n\n'
      How To Use Me 👇👇 \n\n powerurlshortener.link & Complete Your Registration.\n\n'
    ✅2. Then Copy Your API Key from here https://powerurlshortener.link/member/tools/api Copy Your API Only. \n\n'
    ✅3. Then add your API using command /api \n\n' 
    Example: /api c49399f821fc020161bc2a31475ec59f35ae5b4\n\n'
    ⚠️ You must have to send link with https:// or http://\n\n'
    Made with ❤️ By: https://t.me/powerurlshortener';
    **Now, go ahead and try it out!**';
  ➕ Hit 👉 /add_footer To Get Help About Adding your Custom Footer to bot.
  ➕ Hit 👉 /add_header To Get Help About Adding your Custom Footer to bot.
  🔥 Now send me any message or post containing links and I’ll shorten them for you!

  👨‍💻 Created by: https://t.me/namenainai`; 


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

// /add_header command
bot.onText(/\/add_header (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const header = match[1].trim();
  saveUserHeader(chatId, header);
  bot.sendMessage(chatId, `✅ Your custom header has been saved.`);
});

// /add_footer command
bot.onText(/\/add_footer (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const footer = match[1].trim();
  saveUserFooter(chatId, footer);
  bot.sendMessage(chatId, `✅ Your custom footer has been saved.`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // যদি কমান্ড হয়, স্কিপ করে দিন
  if (msg.text && msg.text.startsWith('/')) return;

  const text = msg.text || msg.caption || '';
  const links = extractLinks(text);

  // যদি কোন লিংক পাওয়া যায়
  if (links.length > 0) {
    const shortenedLinks = await shortenMultipleLinks(chatId, links);
    const updatedText = replaceLinksInText(text, links, shortenedLinks);

    const { header, footer } = getUserHeaderFooter(chatId);
    const finalText = header + updatedText + footer;

    // যদি ছবি হয়
    if (msg.photo) {
      const photoFileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, photoFileId, {
        caption: finalText,
        reply_to_message_id: msg.message_id
      });
    }

    // যদি ভিডিও হয়
    else if (msg.video) {
      const videoFileId = msg.video.file_id;
      await bot.sendVideo(chatId, videoFileId, {
        caption: finalText,
        reply_to_message_id: msg.message_id
      });
    }

    // যদি শুধু টেক্সট হয়
    else {
      await bot.sendMessage(chatId, finalText, {
        reply_to_message_id: msg.message_id
      });
    }

    return; // লিংক শর্ট করার পর এখানেই থামুন
  }

  // যদি কোন লিংক না থাকে, তখন শুধু আগের মেসেজটাই রি-সেন্ড করুন
  if (msg.photo) {
    const photoFileId = msg.photo[msg.photo.length - 1].file_id;
    await bot.sendPhoto(chatId, photoFileId, {
      caption: text,
      reply_to_message_id: msg.message_id
    });
  } else if (msg.video) {
    const videoFileId = msg.video.file_id;
    await bot.sendVideo(chatId, videoFileId, {
      caption: text,
      reply_to_message_id: msg.message_id
    });
  } else if (msg.text) {
    await bot.sendMessage(chatId, msg.text, {
      reply_to_message_id: msg.message_id
    });
  }
});
