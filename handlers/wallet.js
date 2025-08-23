const axios = require("axios");
const qs = require("qs");

// Util: validate email
function isEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

// DB helpers
async function getUserId(db, telegramId) {
  const [users] = await db.query(
    "SELECT id FROM users WHERE telegram_id = ?",
    [telegramId]
  );
  return users.length ? users[0].id : null;
}

async function getCurrentWallet(db, userId) {
  const [wallets] = await db.query(
    "SELECT wallet_email, userhash FROM wallet WHERE user_id = ?",
    [userId]
  );
  return wallets.length ? wallets[0] : null;
}

async function isUserHashRegistered(db, userhash, userId) {
  const [rows] = await db.query(
    "SELECT user_id FROM wallet WHERE userhash = ? AND user_id <> ?",
    [userhash, userId]
  );
  return rows.length > 0;
}

// FaucetPay API
async function checkFaucetPay(address, apiKey) {
  try {
    const resp = await axios.post(
      "https://faucetpay.io/api/v1/checkaddress",
      qs.stringify({ api_key: apiKey, address }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    return resp.data;
  } catch (err) {
    console.error("FaucetPay API Error:", err.response?.data || err.message);
    return { status: 0, message: "FaucetPay API Error: Could not reach API." };
  }
}

// Main wallet handler (called from /wallet or when user types email)
module.exports = async (bot, db, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const apiKey = process.env.FAUCETPAY_API_KEY;

  const userId = await getUserId(db, telegramId);
  if (!userId) {
    await bot.sendMessage(chatId, "❌ Please register first with /start.");
    return;
  }

  const userMsg = (msg.text || "").trim();
  const current = await getCurrentWallet(db, userId);

  // If not an email, just show current wallet + inline button
  if (!isEmail(userMsg)) {
    if (current) {
      await bot.sendMessage(
        chatId,
        `💼 *Your FaucetPay Wallet*\n\n📧 Email: \`${current.wallet_email}\`\n\nYou can update anytime.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Update FaucetPay Email", callback_data: "update_wallet_start" }],
            ],
          },
        }
      );
    } else {
      await bot.sendMessage(
        chatId,
        "🔗 You haven’t linked a FaucetPay email yet.\n\nPress below to set it now.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Link FaucetPay Email", callback_data: "update_wallet_start" }],
            ],
          },
        }
      );
    }
    return;
  }

  // If it's an email → validate with FaucetPay
  const apiData = await checkFaucetPay(userMsg, apiKey);

  if (apiData.status === 200 && apiData.payout_user_hash) {
    if (await isUserHashRegistered(db, apiData.payout_user_hash, userId)) {
      await bot.sendMessage(
        chatId,
        "❌ This FaucetPay wallet/email is already linked to another user."
      );
      return;
    }

    if (current && current.userhash === apiData.payout_user_hash) {
      await bot.sendMessage(chatId, "✅ This FaucetPay email is already linked to your account.");
      return;
    }

    await db.query(
      `INSERT INTO wallet (user_id, wallet_email, userhash, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         wallet_email = VALUES(wallet_email),
         userhash = VALUES(userhash),
         updated_at = NOW()`,
      [userId, userMsg, apiData.payout_user_hash]
    );

    await bot.sendMessage(
      chatId,
      `🎉 *FaucetPay email updated successfully!*\n\n📧 Email: \`${userMsg}\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Update Again", callback_data: "update_wallet_start" }],
          ],
        },
      }
    );
  } else if (apiData.status === 456) {
    await bot.sendMessage(chatId, "❌ This email is NOT registered with FaucetPay.");
  } else if ([400, 401, 403].includes(apiData.status)) {
    await bot.sendMessage(
      chatId,
      `❌ FaucetPay API Key error: ${apiData.message || "Invalid API Key."}`
    );
  } else {
    await bot.sendMessage(
      chatId,
      `❌ FaucetPay API error: ${apiData.message || "Unknown error."}`
    );
  }
};

// 🔹 Inline button handler (called from bot.on('callback_query'))
module.exports.handleCallbackQuery = async (bot, db, query) => {
  const chatId = query.message.chat.id;

  if (query.data === "update_wallet_start") {
    await bot.sendMessage(
      chatId,
      "✍️ Please send me your new FaucetPay email address."
    );
  }
};
