// balance.js
module.exports = async (bot, db, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const adminUsername = process.env.ADMIN_USERNAME || "Admin";

  try {
    const [rows] = await db.query(
      'SELECT wallet_balance FROM users WHERE telegram_id = ?', 
      [telegramId]
    );
    const balance = rows.length > 0 ? (rows[0].wallet_balance ?? 0) : 0;

    if (!rows.length) {
      await bot.sendMessage(chatId, '❌ Balance info not found. Please use /start to register.');
      return;
    }

    // Always show both Deposit and Withdraw
    const inlineKeyboard = [
      [{ text: "💸 Deposit", url: `https://t.me/${adminUsername.replace(/^@/, "")}` }],
      [{ text: "🏦 Withdraw", callback_data: "withdraw_fund" }]
    ];

    await bot.sendMessage(
      chatId,
      `💰 <b>Your Current Balance:</b> <b>${parseFloat(balance).toFixed(4)} TRX</b>\n\n` +
      `🔹 <b>Deposit funds instantly or withdraw anytime.</b>`,
      {
        reply_markup: { inline_keyboard: inlineKeyboard },
        parse_mode: "HTML"
      }
    );

    // Handle Withdraw button click
    bot.once("callback_query", async (query) => {
      if (query.message.chat.id !== chatId) return; // ensure only this chat
      if (query.data === "withdraw_fund") {
        if (balance < 20) {
          await bot.answerCallbackQuery(query.id, { 
            text: "🚫 Minimu ₹20 required to withdraw!", 
            show_alert: true 
          });
        } else {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(
            chatId,
            `🏦 <b>Withdraw Request</b>\n\n` +
            `Click the button below to contact admin and withdraw your funds.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📤 Contact Admin", url: `https://t.me/${adminUsername.replace(/^@/, "")}` }]
                ]
              },
              parse_mode: "HTML"
            }
          );
        }
      }
    });

  } catch (error) {
    console.error('Error retrieving balance:', error);
    bot.sendMessage(chatId, '⚠️ Sorry, an error occurred while retrieving your balance. Please try again later.');
  }
};
