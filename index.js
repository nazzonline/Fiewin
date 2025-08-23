require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const startHandler = require('./handlers/start');
const walletHandler = require('./handlers/wallet');
const gameHandler = require('./handlers/game');
const faucetHandler = require('./handlers/faucet');
const balanceHandler = require('./handlers/balance');
const inviteHandler = require('./handlers/invite');
const levelHandler = require('./handlers/level');

const { mainKeyboard } = require('./keyboard');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Utility: always use for sending messages to avoid bot crash if user blocked bot
async function safeSendMessage(chatId, text, opts) {
  try {
    await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    if (err.response && err.response.statusCode === 403) {
      console.log(`❗️User @ chatId ${chatId} has blocked the bot or disabled chat.`);
      // Optionally: mark user inactive/unreachable in DB here
    } else {
      console.error("Telegram sendMessage error:", err);
    }
  }
}

// Command handlers
bot.onText(/\/start/, (msg) => {
  try { startHandler(bot, db, msg); }
  catch (err) { console.error('/start handler error:', err); }
});
bot.onText(/\/wallet/, (msg) => {
  try { walletHandler(bot, db, msg); }
  catch (err) { console.error('/wallet handler error:', err); }
});
bot.onText(/\/bet (\d+)/, async (msg, match) => {
  try {
    await gameHandler.main(bot, db, msg, match);
    await levelHandler(bot, db, msg.from.id, msg.chat.id);
  } catch (err) {
    console.error('/bet handler error:', err);
  }
});

// Keyboard/menu button handler + wallet email handler
bot.on('message', async (msg) => {
  const text = (msg.text || '').trim();
  try {
    // Main menu buttons
    switch (text) {
      case '🎮 Games':
        await gameHandler.main(bot, db, msg);
        return;
      case '🎁 Faucet':
        await faucetHandler(bot, db, msg);
        return;
      case '💰 Balance':
        await balanceHandler(bot, db, msg);
        return;
      case '🤝 Invite':
        await inviteHandler(bot, db, msg);
        return;
      case '👛 Wallet':
        await walletHandler(bot, db, msg);
        return;
    }

    // If this message looks like an email, treat it as a wallet update
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await walletHandler(bot, db, msg);
    }
  } catch (err) {
    console.error('Message handler error:', err);
    await safeSendMessage(msg.chat.id, '⚠️ Sorry, something went wrong processing your request. Please try again.');
  }
});

// Inline keyboard callback handling for game, faucet, wallet, and bet-level
bot.on('callback_query', async (query) => {
  try {
    // Game UI
    if (
      query.data.startsWith('bet_') ||
      query.data === 'place_bet'
    ) {
      await gameHandler.handleCallbackQuery(bot, db, query);
      await levelHandler(bot, db, query.from.id, query.message.chat.id);
      return;
    }

    // Faucet claim UI
    if (
      query.data.startsWith('faucet_claim')
    ) {
      await faucetHandler.handleCallbackQuery(bot, db, query);
      return;
    }

    // Wallet "Update Wallet" inline handler
    if (query.data === 'update_wallet_start') {
      await walletHandler.handleCallbackQuery(bot, db, query);
      return;
    }

    // Add further callback handlers here as needed
  } catch (err) {
    console.error('Callback query handler error:', err);
    const chatId = query.message && query.message.chat && query.message.chat.id
      ? query.message.chat.id
      : null;
    if (chatId) await safeSendMessage(chatId, '⚠️ Sorry, something went wrong. Please try again.');
  }
});

// Optional error logging
bot.on('polling_error', (err) => console.error('Polling error:', err));
