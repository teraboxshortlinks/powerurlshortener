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
// Basic web server for deployment purposes (e.g., to keep Heroku/Render awake)
app.get('/', (req, res) => {
  res.send('Hello World! Bot is running.');
});

// Use PORT environment variable provided by hosting platforms (like Heroku, Railway, Render)
// or default to 8080 for local development.
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// --- Telegram Bot Setup ---
// The bot token MUST be set as an environment variable for security and deployment best practices.
// Example: export TELEGRAM_BOT_TOKEN="YOUR_ACTUAL_BOT_TOKEN_HERE"
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set.');
  console.error('Please set it with your Telegram bot API token (e.g., `export TELEGRAM_BOT_TOKEN="YOUR_TOKEN_HERE"`) before running the bot.');
  process.exit(1); // Exit the process if the token is missing, as the bot can't function.
}

const bot = new TelegramBot(botToken, { polling: true }); // Enable polling to receive updates

// Set bot commands that appear in Telegram's command menu
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
// Path to the JSON database file. It's placed in a 'src' subdirectory.
const dbPath = path.join(__dirname, 'src', 'database.json');

// Ensure the 'src' directory exists. If not, create it recursively.
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
// Create the database file with an empty JSON object if it doesn't exist.
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '{}');
}

/**
 * Reads and parses the database JSON file.
 * Handles potential errors during file reading or JSON parsing.
 * @returns {Object} The database object, or an empty object if an error occurs.
 */
function getDatabaseData() {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error.message);
    return {}; // Return an empty object on error to prevent application crashes.
  }
}

/**
 * Saves a key-value pair for a specific chat ID to the database.
 * Creates the user's data entry if it doesn't exist.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key to store (e.g., 'token', 'header', 'channel').
 * @param {any} value - The value to be stored.
 */
function saveToDatabase(chatId, key, value) {
  const db = getDatabaseData();
  if (!db[chatId]) {
    db[chatId] = {}; // Initialize user's data if it doesn't exist.
  }
  db[chatId][key] = value;
  // Write the updated database back to the file, formatted for readability (2-space indentation).
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

/**
 * Retrieves a value associated with a specific chat ID and key from the database.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key whose value is to be retrieved.
 * @returns {any|undefined} The stored value, or `undefined` if the chat ID or key is not found.
 */
function getFromDatabase(chatId, key) {
  const db = getDatabaseData();
  return db[chatId]?.[key]; // Uses optional chaining for safe access.
}

/**
 * Deletes a specific key-value pair for a given chat ID from the database.
 * @param {number} chatId - The unique ID of the Telegram chat.
 * @param {string} key - The key to be deleted.
 * @returns {boolean} `true` if the key was deleted, `false` if it wasn't found.
 */
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
    header: `${header ? header + '' : ''}`, // Add a newline only if a custom header exists.
    footer: `${footer ? '\n' + footer : ''}\n\n✅ Powered by PowerURLShortener.link` // Add newline for custom footer, then the default.
  };
}

/**
 * Extracts all valid URLs (http/https or www.) from a given text.
 * @param {string} text - The input string to search for URLs.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractLinks(text) {
  // Regex to match URLs starting with http(s):// or www.
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  return [...text.matchAll(urlRegex)].map(match => match[0]);
}

/**
 * Replaces original links in a text string with their shortened versions.
 * Ensures that if a link appears multiple times, all instances are replaced.
 * @param {string} originalText - The text containing original links.
 * @param {string[]} originalLinks - An array of the original URLs found in `originalText`.
 * @param {string[]} shortenedLinks - An array of the corresponding shortened URLs.
 * @returns {string} The text with all original links replaced by their shortened versions.
 */
async function replaceLinksInText(originalText, originalLinks, shortenedLinks) {
  let replacedText = originalText;
  originalLinks.forEach((link, index) => {
    // Only replace if a valid shortened URL exists for the current index.
    if (shortenedLinks[index]) {
      // Create a global regular expression to replace ALL occurrences of the link.
      // `escapeRegExp` is crucial to handle special characters in URLs (e.g., periods, slashes).
      const regex = new RegExp(escapeRegExp(link), 'g');
      replacedText = replacedText.replace(regex, shortenedLinks[index]);
    }
  });
  return replacedText;
}

/**
 * Escapes special characters in a string so it can be safely used within a RegExp constructor.
 * This prevents errors if the URL contains characters like '.', '+', '?', etc.
 * @param {string} string - The string to escape.
 * @returns {string} The escaped string, safe for RegExp.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Shortens a single URL by making an API call to PowerURLShortener.
 * Handles cases where the API token is missing or if the API call fails.
 * @param {number} chatId - The ID of the chat (used to retrieve the user's API token).
 * @param {string} url - The URL string to be shortened.
 * @returns {Promise<string|null>} A promise that resolves to the shortened URL, or the original URL if shortening fails.
 * Returns `null` if no API token is set for the user.
 */
async function shortenUrl(chatId, url) {
  const token = getFromDatabase(chatId, 'token');
  if (!token) {
    // If no token, we can't shorten. The main message handler will inform the user.
    return null;
  }
  try {
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&url=${encodeURIComponent(url)}`);
    // The PowerURLShortener API can return the shortened URL in different keys.
    // Prioritize 'shortenedUrl', then 'shortened', then 'short', finally fallback to original URL.
    return res.data.shortenedUrl || res.data.shortened || res.data.short || url;
  } catch (err) {
    console.error(`Error shortening URL "${url}" for chat ${chatId}:`, err.message);
    // Log more details if it's an HTTP error response from the API.
    if (err.response) {
      console.error(`API Error Response: Status ${err.response.status}, Data:`, err.response.data);
    }
    return url; // Return original URL on any shortening error.
  }
}

/**
 * Shortens multiple URLs concurrently using `Promise.all`.
 * This is more efficient than shortening them one by one.
 * @param {number} chatId - The ID of the chat.
 * @param {string[]} links - An array of URLs to shorten.
 * @returns {Promise<string[]>} A promise that resolves to an array of shortened URLs.
 * If a URL fails to shorten, its original form is returned in its place.
 */
async function shortenMultipleLinks(chatId, links) {
  const promises = links.map(link => shortenUrl(chatId, link));
  const results = await Promise.all(promises);
  // Ensure an entry exists for each original link, even if shortening failed.
  return results.map((shortened, index) => shortened || links[index]);
}

// --- Telegram Message Sending Utility ---

/**
 * Generic function to send various types of Telegram messages with robust error handling.
 * This centralizes message sending logic and error reporting.
 * @param {number} chatId - The ID of the chat or channel to send the message to.
 * @param {string} type - The type of message to send ('text', 'photo', 'video', 'mediaGroup').
 * @param {string|string[]|Object[]} content - The content to send (e.g., text string, file_id, or array for mediaGroup).
 * @param {Object} [options={}] - Optional parameters for the Telegram API method (e.g., parse_mode, reply_to_message_id).
 * @param {boolean} [options.isUserChat=false] - A custom flag to indicate if the message is for the user's direct chat.
 * Used for specific error messages to the user.
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
        // For media groups, content should be an array of {type, media, caption}.
        // The TelegramBot library handles `media` as file_id, URL, or Buffer.
        await bot.sendMediaGroup(chatId, content, options);
        break;
      default:
        console.warn(`Unknown message type: ${type} for chat ID ${chatId}.`);
        break;
    }
    // console.log(`Successfully sent ${type} to chat ${chatId}`); // Uncomment for detailed successful send logging.
  } catch (error) {
    console.error(`Failed to send ${type} to chat ID ${chatId}:`, error.message);
    // Specific handling for 'chat not found' errors, which often occur with incorrect channel IDs
    // or if the bot was kicked/blocked from a chat.
    if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description.includes('chat not found')) {
      console.warn(`Error details: Chat ID ${chatId} not found. This might be due to an incorrect channel ID, the bot being blocked, or not being an admin.`);
      // Only inform the user in their personal chat, not the channel (to avoid spamming error messages).
      if (options.isUserChat) {
        await bot.sendMessage(chatId, "⚠️ Sorry! I couldn't send the message to the specified chat/channel. Please ensure the ID is correct and I have the necessary permissions (e.g., admin rights to post messages).", { parse_mode: 'Markdown' });
      }
    } else {
      // General error logging for other types of send failures.
      console.error(`An unexpected error occurred while sending ${type} to chat ${chatId}:`, error);
    }
  }
}

// --- Bot Command Handlers ---

// Handles the /start command.
bot.onText(/\/start/, async (msg) => {
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

  await sendTelegramMessage(msg.chat.id, 'text', welcomeText, { parse_mode: 'Markdown', isUserChat: true });
});

// Handles the /api command to set the user's API token.
bot.onText(/\/api (.+)/, async (msg, match) => {
  const apiToken = match[1].trim(); // Extract the API token from the command arguments.
  saveToDatabase(msg.chat.id, 'token', apiToken); // Save it to the database.
  await sendTelegramMessage(msg.chat.id, 'text', '✅ API token saved.', { isUserChat: true });
});

@bot.message_handler(commands=['add_header'])
def add_header(message):
    user_id = str(message.from_user.id)
    header_text = message.text.replace("/add_header", "").strip()
    if not header_text:
        bot.reply_to(message, "✍️ Please enter header text after /add_header")
        return
    # ✅ No auto short link in header text
    data = load_data()
    if user_id not in data:
        data[user_id] = {}
    data[user_id]["header"] = header_text
    save_data(data)
    bot.reply_to(message, f"✅ Header saved (link not shortened):\n\n{header_text}")


@bot.message_handler(commands=['add_footer'])
def add_footer(message):
    user_id = str(message.from_user.id)
    footer_text = message.text.replace("/add_footer", "").strip()
    if not footer_text:
        bot.reply_to(message, "✍️ Please enter footer text after /add_footer")
        return
    # ✅ No auto short link in footer text
    data = load_data()
    if user_id not in data:
        data[user_id] = {}
    data[user_id]["footer"] = footer_text
    save_data(data)
    bot.reply_to(message, f"✅ Footer saved (link not shortened):\n\n{footer_text}")
// Handles the /set_channel command to configure the auto-post channel.
// MODIFIED: Now supports both public (@username) and private (+invite_hash) Telegram channel links.
bot.onText(/\/set_channel (.+)/, async (msg, match) => {
  let inputChannel = match[1].trim(); // Get the raw input from the user (could be ID, @username, or link).

  // Regex to attempt to extract @username from public links (t.me/username) OR the invite hash from private links (t.me/+invite_hash)
  const telegramLinkRegex = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+-]+)/i;
  const matchLink = inputChannel.match(telegramLinkRegex);

  if (matchLink && matchLink[1]) {
    const extractedPart = matchLink[1];
    // If the extracted part starts with '+', it's likely a private invite hash.
    // Otherwise, it's a username.
    if (extractedPart.startsWith('+')) {
      inputChannel = extractedPart; // Keep the invite hash as is (Telegram accepts it directly).
      console.log(`Extracted private channel invite hash from link: ${inputChannel}`);
    } else {
      inputChannel = `@${extractedPart}`; // Prefix with '@' for public channel usernames.
      console.log(`Extracted public channel username from link: ${inputChannel}`);
    }
  }

  // Now, validate the processed channel ID/username.
  // It should start with '-100' for numeric private channel IDs, '@' for public channel usernames, or '+' for private invite links.
  if (!inputChannel.startsWith('-100') && !inputChannel.startsWith('@') && !inputChannel.startsWith('+')) {
      await sendTelegramMessage(msg.chat.id, 'text', '⚠️ Please provide a valid channel ID, @username, or a Telegram channel invite link (e.g., `-1001234567890`, `@MyChannel`, or `https://t.me/+invite_hash`).', { isUserChat: true, parse_mode: 'Markdown' });
      return;
  }

  saveToDatabase(msg.chat.id, 'channel', inputChannel); // Save the validated channel identifier.
  await sendTelegramMessage(msg.chat.id, 'text', `✅ Channel set to: \`${inputChannel}\`. Please ensure I am an **administrator** in this channel with permission to post messages.`, { parse_mode: 'Markdown', isUserChat: true });
});

// Handles the /remove_channel command to disable auto-posting.
bot.onText(/\/remove_channel/, async (msg) => {
  const removed = deleteFromDatabase(msg.chat.id, 'channel'); // Remove the channel setting.
  await sendTelegramMessage(msg.chat.id, 'text', removed ? '✅ Channel removed.' : 'ℹ️ No channel was set.', { isUserChat: true });
});

// Handles the /my_channel command to show the current auto-post channel.
bot.onText(/\/my_channel/, async (msg) => {
  const channel = getFromDatabase(msg.chat.id, 'channel'); // Retrieve the channel setting.
  await sendTelegramMessage(msg.chat.id, 'text', channel ? `📢 Your current auto-post channel: \`${channel}\`` : 'No auto-post channel is set.', { parse_mode: 'Markdown', isUserChat: true });
});

// Handles the /balance command to check the user's PowerURLShortener balance.
bot.onText(/\/balance/, async (msg) => {
  const token = getFromDatabase(msg.chat.id, 'token');
  if (!token) {
    return await sendTelegramMessage(msg.chat.id, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN` first.', { isUserChat: true });
  }

  try {
    console.log(`Attempting to fetch balance for chat ${msg.chat.id}.`);
    const res = await axios.get(`https://powerurlshortener.link/api?api=${token}&action=userinfo`);
    console.log('PowerURLShortener API response for balance:', res.data); // Log full API response for debugging.

    if (res.data && res.data.status === 'success') {
      await sendTelegramMessage(msg.chat.id, 'text', `💰 Balance: $${res.data.balance}\n👁️ Clicks: ${res.data.clicks}`, { isUserChat: true });
    } else {
      // If API returns an error message (e.g., 'invalid token'), display it.
      const errorMessage = res.data && res.data.message ? res.data.message : 'Invalid API token or an unexpected error occurred on the shortening service.';
      await sendTelegramMessage(msg.chat.id, 'text', `❌ Failed to fetch balance: ${errorMessage}`, { isUserChat: true });
    }
  } catch (error) {
    console.error(`Error fetching balance for chat ${msg.chat.id}:`, error.message);
    // Log detailed response if available from axios error object.
    if (error.response) {
        console.error('API Error Response Data:', error.response.data);
        console.error('API Error Response Status:', error.response.status);
    }
    await sendTelegramMessage(msg.chat.id, 'text', '🚫 Failed to fetch balance. This could be due to a network issue or the API being temporarily unavailable. Please try again later.', { isUserChat: true });
  }
});

// --- Main Message Handler for URL Shortening and Content Forwarding ---

// Object to temporarily store media group messages until all parts are received.
// Telegram sends parts of a media group separately, so we collect them before processing.
const mediaGroups = {};

// This handler processes ALL incoming messages (text, photos, videos, media groups).
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // --- Pre-processing & Early Exits ---
  // Ignore messages that are clearly commands (start with / and no spaces) to prevent re-processing.
  // Exception: allow the `/api` command itself to go through, as its arguments are processed here.
  if (msg.text && msg.text.startsWith('/') && !msg.text.startsWith('/api') && msg.text.length > 1 && !msg.text.includes(' ')) {
      return;
  }

  const { header, footer } = getUserHeaderFooter(chatId); // Get user's custom header and footer.
  // Check if the message was forwarded (from a user or another chat/channel).
  const isForwarded = msg.forward_from || msg.forward_from_chat;
  const autoPostChannel = getFromDatabase(chatId, 'channel'); // Get the user's configured auto-post channel.
  const userApiToken = getFromDatabase(chatId, 'token'); // Get the user's API token.

  // If no API token is set, inform the user and stop processing for shortening.
  if (!userApiToken && !(msg.text && msg.text.startsWith('/api'))) { // Exclude `/api` command itself from this check.
    await sendTelegramMessage(chatId, 'text', '⚠️ Your API token is not set. Please set it using `/api YOUR_API_TOKEN` to use the URL shortening features.', { parse_mode: 'Markdown', isUserChat: true });
    return;
  }

  // --- Handle Media Groups (multiple photos/videos sent together) ---
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;

    if (!mediaGroups[groupId]) {
      mediaGroups[groupId] = [];
      // Set a timeout to process the media group after a short delay (e.g., 500ms).
      // This gives Telegram time to send all parts of the group, as they arrive as separate 'message' updates.
      setTimeout(async () => {
        const group = mediaGroups[groupId];
        delete mediaGroups[groupId]; // Clear the group from temporary storage after processing.
        if (!group?.length) return; // Exit if the group is empty for some reason.

        // The caption for a media group is typically attached to the first message in the group.
        const caption = group.find(m => m.caption)?.caption || '';
        const links = extractLinks(caption);
        let updatedCaption = caption;

        if (links.length > 0) {
          const shortened = await shortenMultipleLinks(chatId, links);
          updatedCaption = await replaceLinksInText(caption, links, shortened);
        }

        const finalCaption = `${header}${updatedCaption}${footer}`;

        // Prepare the media array for `bot.sendMediaGroup`.
        // Each item needs 'type', 'media' (file_id), and an optional 'caption' (only for the first item).
        const media = group.map((m, i) => {
            let mediaType = '';
            let fileId = '';
            if (m.photo) {
                mediaType = 'photo';
                fileId = m.photo[m.photo.length - 1].file_id; // Get the file_id for the highest quality photo.
            } else if (m.video) {
                mediaType = 'video';
                fileId = m.video.file_id;
            } else {
                return null; // Skip unsupported media types within the group (e.g., text-only messages in a mixed group).
            }

            return {
                type: mediaType,
                media: fileId,
                caption: i === 0 ? finalCaption : undefined // Only the very first item in the group gets the combined caption.
            };
        }).filter(Boolean); // Remove any null entries resulting from unsupported media types.

        if (media.length > 0) {
            // Send the media group back to the user's chat, replying to the original first message of the group.
            await sendTelegramMessage(chatId, 'mediaGroup', media, { reply_to_message_id: group[0].message_id, isUserChat: true });
            // If an auto-post channel is set, send the media group there too.
            if (autoPostChannel) {
                await sendTelegramMessage(autoPostChannel, 'mediaGroup', media);
            }
        }
      }, 500); // 500ms delay to allow all parts of the media group to arrive.
    }
    mediaGroups[groupId].push(msg); // Add the current message part to its respective media group.
    return; // Stop further processing for this message, as it's part of a group that will be handled by the timeout.
  }

  // --- Handle Forwarded Single Photos and Videos ---
  // If a message is forwarded AND contains a photo...
  if (isForwarded && msg.photo) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);
    const shortened = await shortenMultipleLinks(chatId, links);
    const updated = await replaceLinksInText(caption, links, shortened);
    const finalCaption = `${header}${updated}${footer}`;
    const photoId = msg.photo[msg.photo.length - 1].file_id; // Get highest quality photo ID.

    await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalCaption, reply_to_message_id: msg.message_id, isUserChat: true });
    if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', photoId, { caption: finalCaption });
    return;
  }

  // If a message is forwarded AND contains a video...
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
  // Get the content, which could be plain text or a caption of a photo/video.
  const content = msg.text || msg.caption || '';
  const links = extractLinks(content); // Extract any URLs from the content.

  if (links.length > 0) {
    // If URLs are found, proceed with shortening.
    const shortened = await shortenMultipleLinks(chatId, links);
    const updatedContent = await replaceLinksInText(content, links, shortened);
    const finalContentWithHeaderFooter = `${header}${updatedContent}${footer}`;

    if (msg.photo) {
      // If the message is a photo with a caption containing links.
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await sendTelegramMessage(chatId, 'photo', photoId, { caption: finalContentWithHeaderFooter, reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'photo', photoId, { caption: finalContentWithHeaderFooter });
    } else if (msg.video) {
      // If the message is a video with a caption containing links.
      await sendTelegramMessage(chatId, 'video', msg.video.file_id, { caption: finalContentWithHeaderFooter, reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'video', msg.video.file_id, { caption: finalContentWithHeaderFooter });
    } else {
      // If it's a plain text message containing links.
      await sendTelegramMessage(chatId, 'text', finalContentWithHeaderFooter, { reply_to_message_id: msg.message_id, isUserChat: true });
      if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalContentWithHeaderFooter);
    }
  } else if (msg.text && !msg.text.startsWith('/')) {
    // This block handles plain text messages that *do not* contain links
    // and are *not* Telegram commands.
    const rawText = msg.text;
    const finalContentWithHeaderFooter = `${header}${rawText}${footer}`;

    // Only send the message if the content was actually modified by a header/footer
    // OR if the original message text was not empty (to avoid sending empty replies).
    // This prevents the bot from replying to every single non-command text message if no headers/footers are set.
    if (finalContentWithHeaderFooter.trim() !== rawText.trim() || rawText.trim() !== '') {
        await sendTelegramMessage(chatId, 'text', finalContentWithHeaderFooter, { reply_to_message_id: msg.message_id, isUserChat: true });
        if (autoPostChannel) await sendTelegramMessage(autoPostChannel, 'text', finalContentWithHeaderFooter);
    }
  }
});

console.log('Bot is running and listening for messages...');
