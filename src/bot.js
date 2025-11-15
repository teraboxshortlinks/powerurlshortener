// Telegram URL Shortener Bot
// This bot shortens URLs using the PowerURLShortener.link API,
// allows custom headers/footers, manages API tokens per user,
// checks balance, and can auto-post to a specified Telegram channel.

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
// const fs = require('fs'); // <--- ফাইল সিস্টেমের ব্যবহার বাদ দেওয়া হলো
const express = require('express');
const path = require('path');
const app = express();

// --- Web Server Setup ---
const port = process.env.PORT || 8080;
app.get('/', (req, res) => {
  res.send('Hello World! Bot is running.');
});
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

// --- In-Memory Storage for User Settings ---
// WARNING: Data stored here will be LOST when the bot restarts. 
// For permanent data storage, use a proper database like MongoDB.
const userSettings = {};

/**
 * Saves a key-value pair for a specific chat ID to the in-memory object.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key to store (e.g., 'token', 'header', 'channel').
 * @param {any} value - The value to be stored.
 */
function saveToDatabase(chatId, key, value) {
  if (!userSettings[chatId]) {
    userSettings[chatId] = {}; // Initialize user's data if it doesn't exist.
  }
  userSettings[chatId][key] = value;
  // File writing logic removed.
}

/**
 * Retrieves a value associated with a specific chat ID and key from the in-memory object.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key whose value is to be retrieved.
 * @returns {any|undefined} The stored value, or `undefined` if the chat ID or key is not found.
 */
function getFromDatabase(chatId, key) {
  // Uses optional chaining for safe access.
  return userSettings[chatId]?.[key]; 
}

/**
 * Deletes a specific key-value pair for a given chat ID from the in-memory object.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key to be deleted.
 * @returns {boolean} `true` if the key was deleted, `false` if it wasn't found.
 */
function deleteFromDatabase(chatId, key) {
  if (userSettings[chatId] && userSettings[chatId][key]) {
    delete userSettings[chatId][key];
    // File writing logic removed.
    return true;
  }
  return false;
}

// --- Header/Footer and Link Processing Utilities ---

/**
 * Retrieves the user's custom header and footer text.
 * Includes a default "Powered by" footer.
 * @param {number} chatId - The ID of the chat to retrieve settings for.
 * @returns {{header: string, footer: string}} An object containing the formatted header and footer strings.
 */
function getUserHeaderFooter(chatId) {
  const header = getFromDatabase(chatId, 'header') || '';
  const footer = getFromDatabase(chatId, 'footer') || '';
  return {
    header: `${header ? header + '\n\n' : ''}`, 
    footer: `${footer ? '\n' + footer : ''}\n\n\n✅ Powered by teraboxvideo.42web.io`
  };
}

/**
 * Extracts all valid URLs (http/https or www.) from a given text.
 * @param {string} text - The input string to search for URLs.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return [...text.matchAll(urlRegex)].map(match => match[0]);
}

/**
 * Replaces original links in a text string with their shortened versions.
 * @param {string} originalText - The text containing original links.
 * @param {string[]} originalLinks - An array of the original URLs found in `originalText`.
 * @param {string[]} shortenedLinks - An array of the corresponding shortened URLs.
 * @returns {string} The text with all original links replaced by their shortened versions.
 */
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

/**
 * Escapes special characters in a string so it can be safely used within a RegExp constructor.
 * @param {string} string - The string to escape.
 * @returns {string} The escaped string, safe for RegExp.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shortens a single URL by making an API call to PowerURLShortener.
 * @param {number} chatId - The ID of the chat (used to retrieve the user's API token).
 * @param {string} url - The URL string to be shortened.
 * @returns {Promise<string|null>} A promise that resolves to the shortened URL, or the original URL if shortening fails.
 * Returns `null` if no API token is set for the user.
 */
async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) {
    return null;
  }
  try {
    const res = await axios.get(`https://teraboxvideo.42web.io/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    console.error(`Error shortening URL "${url}" for chat ${chatId}:`, err.message);
    if (err.response) {
      console.error(`API Error Response: Status ${err.response.status}, Data:`, err.response.data);
    }
    return url;
  }
}

/**
 * Shortens multiple URLs concurrently using `Promise.all`.
 * @param {number} chatId - The ID of the chat.
 * @param {string[]} links - An array of URLs to shorten.
 * @returns {Promise<string[]>} A promise that resolves to an array of shortened URLs.
 */
async function shortenMultipleLinks(chatId, links) {
  const promises = links.map(link => shortenUrl(chatId, link));
  const results = await Promise.all(promises);
  return results.map((shortened, index) => shortened || links[index]);
}

// --- Telegram Message Sending Utility ---

/**
 * Generic function to send various types of Telegram messages with robust error handling.
 */
async function sendTelegramMessage(chatId, type, content, options = {}) {
  try {
    if (!chatId) {
      console.warn(`Attempted to send message to undefined/null chatId. Type: ${type}, Content: ${JSON.stringify(content).substring(0, 100)}...`);
      return;
    }

    switch (type) {
      case 'text':
        await bot.sendMessage(chatId, content, options);
        break;
      case 'photo':
        await bot.sendPhoto(chatId, content, options);
        break;
      case 'video':
        await bot.sendVideo(chatId, content, options);
        break;
      case 'mediaGroup':
        await bot.sendMediaGroup(chatId, content, options);
        break;
      default:
        console.warn(`Unknown message type: ${type} for chat ID ${chatId}.`);
        break;
    }
  } catch (error) {
    console.error(`Failed to send ${type} to chat ID ${chatId}:`, error.message);
    if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description.includes('chat not found')) {
      console.warn(`Error details: Chat ID ${chatId} not found. This might be due to an incorrect channel ID, the bot being blocked, or not being an admin.`);
      if (options.isUserChat) {
        await bot.sendMessage(chatId, "⚠️ Sorry! I couldn't send the message to the specified chat/channel. Please ensure the ID is correct and I have the necessary permissions (e.g., admin rights to post messages).", { parse_mode: 'Markdown' });
      }
    } else {
      console.error(`An unexpected error occurred while sending ${type} to chat ${chatId}:`, error);
    }
  }
}

// --- Bot Command Handlers (No changes needed, as they call the refactored database functions) ---

bot.onText(/\/start/, async (msg) => {
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  const welcomeText = `😇 *Welcome, ${name}!*

🔗 *PowerURLShortener Bot* helps you shorten any valid URL easily using the [teraboxvideo.42web.io](teraboxvideo.42web.io) API service.

To shorten a URL, just send it directly in the chat — the bot will return a shortened version.

---

📌 *How to Use Me:*
1. Register at [teraboxvideo.42web.io](https://teraboxvideo.42web.io)
2. Get your API key from:
   👉 [https://teraboxvideo.42web.io/member/tools/api](https://teraboxvideo.42web.io/member/tools/api)
3. Set it using: \`/api <your_api>\`

✅ *Example:*
\`/api 15955e51de404141cfc89533e1d692a3140fe120\`

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

  await sendTelegramMessage(msg.chat.id, 'text', welcomeText, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/api (.+)/, async (msg, match) => {
  const apiToken = match[1].trim(); 
  saveToDatabase(msg.chat.id, 'token', apiToken); 
  await sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.', { isUserChat: true });
});

bot.onText(/\/add_header (.+)/, async (msg, match) => {
  saveToDatabase(msg.chat.id, 'header', match[1].trim()); 
  await sendTelegramMessage(msg.chat.id, 'text', '✅ Header saved.', { isUserChat: true });
});

bot.onText(/\/add_footer (.+)/, async (msg, match) => {
  saveToDatabase(msg.chat.id, 'footer', match[1].trim()); 
  await sendTelegramMessage(msg.chat.id, 'text', '✅ Footer saved.', { isUserChat: true });
});

bot.onText(/\/set_channel (.+)/, async (msg, match) => {
  let inputChannel = match[1].trim(); 
  const telegramLinkRegex = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+-]+)/i;
  const matchLink = inputChannel.match(telegramLinkRegex);

  if (matchLink && matchLink[1]) {
    const extractedPart = matchLink[1];
    if (extractedPart.startsWith('+')) {
      inputChannel = extractedPart; 
      console.log(`Extracted private channel invite hash from link: ${inputChannel}`);
    } else {
      inputChannel = `@${extractedPart}`; 
      console.log(`Extracted public channel username from link: ${inputChannel}`);
    }
  }

  if (!inputChannel.startsWith('-100') && !inputChannel.startsWith('@') && !inputChannel.startsWith('+')) {
      await sendTelegramMessage(msg.chat.id, 'text', '⚠️ Please provide a valid channel ID, @username, or a Telegram channel invite link (e.g., `-1001234567890`, `@MyChannel`, or `https://t.me/+invite_hash`).', { isUserChat: true, parse_mode: 'Markdown' });
      return;
  }

  saveToDatabase(msg.chat.id, 'channel', inputChannel); 
  await sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set to: \`${inputChannel}\`. Please ensure I am an **administrator** in this channel with permission to post messages.`, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/remove_channel/, async (msg) => {
  const removed = deleteFromDatabase(msg.chat.id, 'channel'); 
  await sendTelegramMessage(msg.chat.id, 'text', removed ? '✅ Channel removed.' : 'ℹ️ No channel was set.', { isUserChat: true });
});

bot.onText(/\/my_channel/, async (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel'); 
  await sendTelegramMessage(msg.chat.id, 'text', channel ? `📢 Your current auto-post channel: \`${channel}\`` : 'No auto-post channel is set.', { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) {
    return await sendTelegramMessage(msg.chat.id, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN` first.', { isUserChat: true });
  }

  try {
    console.log(`Attempting to fetch balance for chat ${msg.chat.id}.`);
    const res = await axios.get(`https://teraboxvideo.42web.io/member/tools/api?api=${token}&action=userinfo`);
    console.log('PowerURLShortener API response for balance:', res.data); 

    if (res.data && res.data.status === 'success') {
      await sendTelegramMessage(msg.chat.id, 'text', `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`, { isUserChat: true });
    } else {
      const errorMessage = res.data && res.data.message ? res.data.message : 'Invalid API token or an unexpected error occurred on the shortening service.';
      await sendTelegramMessage(msg.chat.id, 'text', `❌ Failed to fetch balance: ${errorMessage}`, { isUserChat: true });
    }
  } catch (error) {
    console.error(`Error fetching balance for chat ${msg.chat.id}:`, error.message);
    if (error.response) {
        console.error('API Error Response Data:', error.response.data);
        console.error('API Error Response Status:', error.response.status);
    }
    await sendTelegramMessage(msg.chat.id, 'text', '🚫 Failed to fetch balance. This could be due to a network issue or the API being temporarily unavailable. Please try again later.', { isUserChat: true });
  }
});

// --- Main Message Handler for URL Shortening and Content Forwarding ---

const mediaGroups = {};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.text && msg.text.startsWith('/') && !msg.text.startsWith('/api') && msg.text.length > 1 && !msg.text.includes(' ')) {
      return;
  }

  const { header, footer } = getUserHeaderFooter(chatId); 
  const isForwarded = msg.forward_from || msg.forward_from_chat;
  const autoPostChannel = getFromDatabase(chatId, 'channel'); 
  const userApiToken = getFromDatabase(chatId, 'token'); 

  if (!userApiToken && !(msg.text && msg.text.startsWith('/api'))) { 
    await sendTelegramMessage(chatId, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN` to use the URL shortening features.', { parse_mode: 'Markdown', isUserChat: true });
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

        const caption = group.find(m => m.caption)?.caption || '';
        const links = extractLinks(caption);
        let updatedCaption = caption;

        if (links.length > 0) {
          const shortened = await shortenMultipleLinks(chatId, links);
          updatedCaption = await replaceLinksInText(caption, links, shortened);
        }

        const finalCaption = `${header}${updatedCaption}${footer}`;

        const media = group.map((m, i) => {
            let mediaType = '';
            let fileId = '';
            if (m.photo) {
                mediaType = 'photo';
                fileId = m.photo[m.photo.length - 1].file_id; 
            } else if (m.video) {
                mediaType = 'video';
                fileId = m.video.file_id;
            } else {
                return null; 
            }

            return {
                type: mediaType,
                media: fileId,
                caption: i === 0 ? finalCaption : undefined 
            };
        }).filter(Boolean); 

        if (media.length > 0) {
            await sendTelegramMessage(chatId, 'mediaGroup', media, { reply_to_message_id: group[0].message_id, isUserChat: true });
            if (autoPostChannel) {
                await sendTelegramMessage(autoPostChannel, 'mediaGroup', media);
            }
        }
      }, 500); 
    }
    mediaGroups[groupId].push(msg); 
    return; 
  }

  // --- Handle Forwarded Single Photos and Videos ---
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    const photoId = msg.photo[msg.photo.length - 1].file_id; 

    await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
    if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', photoId, { caption: finalCaption });
    return;
  }

  if (isForwarded && msg.video) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    await sendTelegramMessage(chatId, 'video', msg.video.file_id, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
    if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', msg.video.file_id, { caption: finalCaption });
    return;
  }

  // --- Handle Normal Messages (text, photo with caption, video with caption) ---
  const content = msg.text || msg.caption || '';
  const links = extractLinks(content); 

  if (links.length > 0) {
    const shortened = await shortenMultipleLinks(chatId, links);
    const updatedContent = await replaceLinksInText(content, links, shortened);
    const finalContentWithHeaderFooter = `${header}${updatedContent}${footer}`;

    if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalContentWithHeaderFooter, reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', photoId, { caption: finalContentWithHeaderFooter });
    } else if (msg.video) {
      await sendTelegramMessage(chatId, 'video', msg.video.file_id, { caption: finalContentWithHeaderFooter, reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', msg.video.file_id, { caption: finalContentWithHeaderFooter });
    } else {
      await sendTelegramMessage(chatId, 'text', finalContentWithHeaderFooter, { reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalContentWithHeaderFooter);
    }
  } else if (msg.text && !msg.text.startsWith('/')) {
    const rawText = msg.text;
    const finalContentWithHeaderFooter = `${header}${rawText}${footer}`;

    if (finalContentWithHeaderFooter.trim() !== rawText.trim() || rawText.trim() !== '') {
        await sendTelegramMessage(chatId, 'text', finalContentWithHeaderFooter, { reply_to_message_id: msg.message_id, isUserChat: true });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalContentWithHeaderFooter);
    }
  }
});

console.log('Bot is running and listening for messages...');
