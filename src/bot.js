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
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true }); // Ensure recursive creation
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '{}');

function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (error) {
    console.error('Error reading database:', error.message);
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
    header: `${header ? header + '\n\n🔗 Links:\n\n' : ''}`,
    footer: `${footer ? '\n' + footer : ''}\n\n✅ Powered by PowerURLShortener.link`
  };
}

function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return [...text.matchAll(urlRegex)].map(match => match[0]);
}

// This function now correctly takes 'links' and 'shortenedLinks' to replace them
async function replaceLinksInText(originalText, links, shortenedLinks) {
  let replacedText = originalText;
  links.forEach((link, index) => {
    // Only replace if a shortened URL exists for that index
    if (shortenedLinks[index]) {
      replacedText = replacedText.replace(link, shortenedLinks[index]);
    }
  });
  return replacedText;
}

async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) {
    // No need to send message here, it's handled by the main message logic
    return null;
  }
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    console.error(`Error shortening URL ${url} for chat ${chatId}:`, err.message);
    return url; // Return original URL on error
  }
}

async function shortenMultipleLinks(chatId, links) {
  const result = [];
  for (const link of links) {
    const short = await shortenUrl(chatId, link);
    result.push(short || link); // Ensure we always push something
  }
  return result;
}

// Generic function to send message with robust error handling
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
                console.warn(`Unknown message type: ${type}`);
                break;
        }
        // console.log(`Successfully sent ${type} to chat ${chatId}`);
    } catch (error) {
        console.error(`Failed to send ${type} to chat ID ${chatId}:`, error.message);
        if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description.includes('chat not found')) {
            console.warn(`Error details: Chat ID ${chatId} not found. This might be due to incorrect channel ID or the bot being blocked.`);
            // Inform the user if it's their personal chat and the error occurred
            if (options.isUserChat) { // Custom option to identify user's personal chat
                 await bot.sendMessage(chatId, "⚠️ Sorry! I couldn't send the message to the specified chat/channel. Please ensure the ID is correct and I have the necessary permissions.", { parse_mode: 'Markdown' });
            }
        } else {
            console.error(`An unexpected error occurred while sending ${type} to chat ${chatId}:`, error);
        }
    }
}


bot.onText(/\/start/, async (msg) => {
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

  await sendTelegramMessage(msg.chat.id, 'text', text, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/api (.+)/, async (msg, match) => {
  saveToDatabase(msg.chat.id, 'token', match[1].trim());
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
  const channelId = match[1].trim();
  saveToDatabase(msg.chat.id, 'channel', channelId);
  await sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set: \`${channelId}\`. Please ensure I am an admin in this channel.`, { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/remove_channel/, async (msg) => {
  const removed = deleteFromDatabase(msg.chat.id, 'channel');
  await sendTelegramMessage(msg.chat.id, 'text', removed ? '✅ Channel removed.' : 'ℹ️ No channel was set.', { isUserChat: true });
});

bot.onText(/\/my_channel/, async (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel');
  await sendTelegramMessage(msg.chat.id, 'text', channel ? `📢 Your channel: \`${channel}\`` : 'No channel set.', { parse_mode: 'Markdown', isUserChat: true });
});

bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) return await sendTelegramMessage(msg.chat.id, 'text', '⚠️ First set API: /api YOUR_TOKEN', { isUserChat: true });

  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    if (res.data.status === 'success') {
      await sendTelegramMessage(msg.chat.id, 'text', `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`, { isUserChat: true });
    } else {
      await sendTelegramMessage(msg.chat.id, 'text', '❌ Invalid API token.', { isUserChat: true });
    }
  } catch (error) {
    console.error(`Failed to fetch balance for chat ${msg.chat.id}:`, error.message);
    await sendTelegramMessage(msg.chat.id, 'text', '🚫 Failed to fetch balance.', { isUserChat: true });
  }
});

// MediaGroup handler
const mediaGroups = {};
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  // Ignore commands
  if (msg.text && (msg.text.startsWith('/') && msg.text.length > 1 && !msg.text.includes(' '))) return;

  const { header, footer } = getUserHeaderFooter(chatId);
  const isForwarded = msg.forward_from || msg.forward_from_chat;
  const channel = getFromDatabase(chatId, 'channel');
  const userApiToken = getFromDatabase(chatId, 'token');

  // If no API token is set, inform the user and stop processing
  if (!userApiToken && !msg.text.startsWith('/api')) { // Allow /api command to set token
    await sendTelegramMessage(chatId, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN`.', { isUserChat: true });
    return;
  }


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
          updatedCaption = await replaceLinksInText(caption, links, shortened);
        }

        const finalCaption = `${header}${updatedCaption}${footer}`;
        const media = group.map((m, i) => {
            const mediaType = m.photo ? 'photo' : (m.video ? 'video' : null);
            if (!mediaType) return null; // Skip unsupported media types

            return {
                type: mediaType,
                media: mediaType === 'photo' ? m.photo[m.photo.length - 1].file_id : m.video.file_id,
                caption: i === 0 ? finalCaption : undefined // Only first item gets caption
            };
        }).filter(Boolean); // Remove any null entries

        if (media.length > 0) {
            await sendTelegramMessage(chatId, 'mediaGroup', media, { reply_to_message_id: group[0].message_id, isUserChat: true });
            if (channel) {
                await sendTelegramMessage(channel, 'mediaGroup', media);
            }
        }
      }, 500); // Give a small delay for all media in the group to arrive
    }
    mediaGroups[groupId].push(msg);
    return;
  }

  // Handle forwarded photo
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
    if (channel) await sendTelegramMessage(channel, 'photo', photoId, { caption: finalCaption });
    return;
  }

  // Handle forwarded video
  if (isForwarded && msg.video) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    await sendTelegramMessage(chatId, 'video', msg.video.file_id, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
    if (channel) await sendTelegramMessage(channel, 'video', msg.video.file_id, { caption: finalCaption });
    return;
  }

  // Normal message / photo / video
  const content = msg.text || msg.caption || '';
  const links = extractLinks(content);

  if (links.length > 0) {
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(content, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;

    if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
      if (channel) await sendTelegramMessage(channel, 'photo', photoId, { caption: finalCaption });
    } else if (msg.video) {
      await sendTelegramMessage(chatId, 'video', msg.video.file_id, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
      if (channel) await sendTelegramMessage(channel, 'video', msg.video.file_id, { caption: finalCaption });
    } else { // Text message
      await sendTelegramMessage(chatId, 'text', finalCaption, { reply_to_message_id: msg.message_id, isUserChat: true });
      if (channel) await sendTelegramMessage(channel, 'text', finalCaption);
    }
  } else if (msg.text && !msg.text.startsWith('/')) { // Only send header/footer for non-link messages if it's not a command
      // If a non-link message is sent, but has header/footer, send it.
      const rawText = msg.text;
      const finalContent = `${header}${rawText}${footer}`;
      if (rawText !== finalContent || rawText.includes("http")) { // Only send if actually modified or contains link.
          await sendTelegramMessage(chatId, 'text', finalContent, { reply_to_message_id: msg.message_id, isUserChat: true });
          if (channel) await sendTelegramMessage(channel, 'text', finalContent);
      }
  }
});
