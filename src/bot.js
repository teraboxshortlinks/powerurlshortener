const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const port = 8080;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Retrieve the Telegram bot token from the environment variable
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Create the Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  const welcomeMessage = `{fullname} , I am botlatournament.xyz , Bulk Link Converter. I Can Convert Links Directly From Your teraboxlinks.com Account,
    
1. Go To 👉 https://botlatournament.xyz/member/tools/api
2. Then Copy API Key
3. Then Type /setapi then give a single space and then paste your API Key (see example to understand more...)
4. How to use teraboxlinks bot- use this video for reference 👉 https://t.me/+m7j-b56KOXkyNDA9

(See Example.👇)
Example: /setapi 04e8ee10b5f123456a640c8f33195abc 

🤘 Hit 👉 features To Know More Features Of This Bot.
🔗 Hit 👉 link To Know More About How To Link teraboxlinks.com Account To This Bot.
💁‍♀ Hit 👉 help To Get Help.
➕ Hit 👉 add Command To Get Help About Adding your channel to bot.
➕ Hit 👉 footer To Get Help About Adding your Custom Footer to bot.

Anyone who want to use any other shortner instead of botlatournament.xyz than contact at 👉 https://t.me/+m7j-b56KOXkyNDA9 (all shortners support avilable.)

- Made With ❤️ By https://t.me/+m7j-b56KOXkyNDA9 -';

  bot.sendMessage(chatId, welcomeMessage);
});

// Command: /setapi
bot.onText(/\/setapi (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userToken = match[1].trim();

  // Save the user's AdlinkFly API token to the database
  saveUserToken(chatId, userToken);

  const response = `Your botlatournament API token set successfully. ✅️✅️ Your token is: ${userToken}`;
  bot.sendMessage(chatId, response);
});

// Listen for any message (not just commands)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Check if message contains text or forwarded content
  if (msg.text || msg.caption) {
    const text = msg.text || msg.caption;
    const links = extractLinks(text);

    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);

      // Replace original links in the text
      const updatedText = replaceLinksInText(text, links, shortenedLinks);

      bot.sendMessage(chatId, updatedText, {
        reply_to_message_id: msg.message_id,
      });
    }
  }

  // If message has media with caption, handle it
  if (msg.photo || msg.video || msg.document) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);

    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);

      // Replace original links in the caption
      const updatedCaption = replaceLinksInText(caption, links, shortenedLinks);

      bot.sendMessage(chatId, updatedCaption, {
        reply_to_message_id: msg.message_id,
      });
    }
  }
});

// Function to extract URLs from a given text
function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})([^\s]*)/g;
  const links = [...text.matchAll(urlRegex)].map(match => match[0]);
  return links;
}

// Function to replace original links with shortened links in the text
function replaceLinksInText(text, originalLinks, shortenedLinks) {
  let updatedText = text;
  originalLinks.forEach((link, index) => {
    updatedText = updatedText.replace(link, shortenedLinks[index]);
  });
  return updatedText;
}

// Function to shorten multiple links
async function shortenMultipleLinks(chatId, links) {
  const shortenedLinks = [];
  for (const link of links) {
    const shortenedLink = await shortenUrl(chatId, link);
    shortenedLinks.push(shortenedLink || link); // Use original link if shortening fails
  }
  return shortenedLinks;
}

// Function to shorten a single URL
async function shortenUrl(chatId, url) {
  const adlinkflyToken = getUserToken(chatId);

  if (!adlinkflyToken) {
    bot.sendMessage(chatId, 'Please set up 🎃 your BotlaTournament API token first. 🔮 Use the command: /setapi YOUR_BOTLATOURNAMENT_API_TOKEN');
    return null;
  }

  try {
    const apiUrl = `https://botlatournament.xyz/api?api=${adlinkflyToken}&url=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl);
    return response.data.shortenedUrl;
  } catch (error) {
    console.error('Shorten URL Error:', error);
    return null;
  }
}

// Function to save user's AdlinkFly API token
function saveUserToken(chatId, token) {
  const dbData = getDatabaseData();
  dbData[chatId] = token;
  fs.writeFileSync('./src/database.json', JSON.stringify(dbData, null, 2));
}

// Function to retrieve user's AdlinkFly API token
function getUserToken(chatId) {
  const dbData = getDatabaseData();
  return dbData[chatId];
}

// Function to read the database file
function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync('./src/database.json', 'utf8'));
  } catch (error) {
    return {};
  }
}
