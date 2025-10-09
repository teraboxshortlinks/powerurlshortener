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
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    return text.match(urlRegex) || [];
}

async function replaceLinksInText(originalText, originalLinks, shortenedLinks) {
  let replacedText = originalText;
  originalLinks.forEach((link, index) => {
    if (shortenedLinks[index] && shortenedLinks[index] !== link) {
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
  if (!token) return url;
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
  }
}

// --- Bot Command Handlers (No Changes Here) ---
bot.onText(/\/start/, (msg) => {
    const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const welcomeText = `😇 *Welcome, ${name}!*...`; // Your welcome text here
    sendTelegramMessage(msg.chat.id, 'text', welcomeText, { parse_mode: 'Markdown' });
});
bot.onText(/\/api (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'token', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.');
});
bot.onText(/\/add_header (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'header', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ Header saved.');
});
bot.onText(/\/add_footer (.+)/, (msg, match) => {
  saveToDatabase(msg.chat.id, 'footer', match[1].trim());
  sendTelegramMessage(msg.chat.id, 'text', '✅ Footer saved.');
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
    return sendTelegramMessage(msg.chat.id, 'text', '⚠️ Please provide a valid channel ID, @username, or a Telegram channel invite link.');
  }
  saveToDatabase(msg.chat.id, 'channel', inputChannel);
  sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set to: \`${inputChannel}\`.`, { parse_mode: 'Markdown' });
});
bot.onText(/\/remove_channel/, (msg) => {
  deleteFromDatabase(msg.chat.id, 'channel');
  sendTelegramMessage(msg.chat.id, 'text', '✅ Channel removed.');
});
bot.onText(/\/my_channel/, (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel');
  sendTelegramMessage(msg.chat.id, 'text', channel ? `📢 Your current auto-post channel: \`${channel}\`` : 'No auto-post channel is set.', { parse_mode: 'Markdown' });
});
bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) return sendTelegramMessage(msg.chat.id, 'text', '⚠️ API token not set.');
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    if (res.data?.status === 'success') {
      sendTelegramMessage(msg.chat.id, 'text', `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`);
    } else {
      sendTelegramMessage(msg.chat.id, 'text', `❌ Failed to fetch balance: ${res.data?.message || 'Invalid API token.'}`);
    }
  } catch (error) {
    sendTelegramMessage(msg.chat.id, 'text', '🚫 Failed to fetch balance.');
  }
});

// --- Main Message Handler ---
const mediaGroups = {};
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Ignore commands to prevent double processing
    if (msg.text && msg.text.startsWith('/')) {
        return;
    }

    // Check for API token
    if (!getFromDatabase(chatId, 'token')) {
        return sendTelegramMessage(chatId, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN`.');
    }

    // This is the main function that processes the content.
    const processContent = async (originalContent) => {
        // Step 1: Extract links ONLY from the original message content
        const linksToShorten = extractLinks(originalContent);
        let processedContent = originalContent;

        // Step 2: If there are links, shorten them and replace them in the content
        if (linksToShorten.length > 0) {
            const shortenedLinks = await shortenMultipleLinks(chatId, linksToShorten);
            processedContent = await replaceLinksInText(originalContent, linksToShorten, shortenedLinks);
        }

        // Step 3: Get header and footer AFTER all link processing is done
        const { header, footer } = getUserHeaderFooter(chatId);
        
        // Step 4: Combine everything to create the final text/caption
        return `${header}${processedContent}${footer}`;
    };

    const autoPostChannel = getFromDatabase(chatId, 'channel');

    // Handle Media Groups
    if (msg.media_group_id) {
        const groupId = msg.media_group_id;
        if (!mediaGroups[groupId]) {
            mediaGroups[groupId] = [];
            setTimeout(async () => {
                const group = mediaGroups[groupId];
                delete mediaGroups[groupId];
                if (!group?.length) return;

                const originalCaption = group.find(m => m.caption)?.caption || '';
                const finalCaption = await processContent(originalCaption);

                const media = group.map((m, i) => ({
                    type: m.photo ? 'photo' : 'video',
                    media: m.photo ? m.photo[m.photo.length - 1].file_id : m.video.file_id,
                    caption: i === 0 ? finalCaption : undefined
                }));

                await sendTelegramMessage(chatId, 'mediaGroup', media, { reply_to_message_id: group[0].message_id });
                if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'mediaGroup', media);
            }, 500);
        }
        mediaGroups[groupId].push(msg);
        return;
    }

    // Handle single Photo, Video, or Text
    const originalContent = msg.text || msg.caption || '';
    const finalOutput = await processContent(originalContent);

    if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await sendTelegramMessage(chatId, 'photo', fileId, { caption: finalOutput, reply_to_message_id: msg.message_id });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', fileId, { caption: finalOutput });
    } else if (msg.video) {
        const fileId = msg.video.file_id;
        await sendTelegramMessage(chatId, 'video', fileId, { caption: finalOutput, reply_to_message_id: msg.message_id });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', fileId, { caption: finalOutput });
    } else if (msg.text) {
        // Only reply if the content actually changed (links were shortened or header/footer was added)
        if (finalOutput.trim() !== originalContent.trim()) {
            await sendTelegramMessage(chatId, 'text', finalOutput, { reply_to_message_id: msg.message_id });
            if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalOutput);
        }
    }
});

console.log('Bot is running and listening for messages...');
``
