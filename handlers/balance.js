// balance.js
module.exports = async (bot, db, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const adminUsername = process.env.ADMIN_USERNAME || "Admin";

  try {
    const [rows] = await db.query(
      "SELECT wallet_balance FROM users WHERE telegram_id = ?",
      [telegramId]
    );
    const balance = rows.length > 0 ? (rows[0].wallet_balance ?? 0) : 0;

    if (!rows.length) {
      await bot.sendMessage(
        chatId,
        "❌ Balance info not found. Please use /start to register."
      );
      return;
    }

    // Three simple URL buttons
    const inlineKeyboard = [
      [{ text: "💸 Deposit", url: `https://t.me/${adminUsername.replace(/^@/, "")}` }],
      [{ text: "🏦 Withdraw", url: "https://t.me/Fiewin_WalletBot?start=withdraw" }],
      [{ text: "📢 Payment Updates", url: "https://t.me/fiewin_payments" }]
    ];

    await bot.sendMessage(
      chatId,
      `💰 <b>Your Current Balance:</b> <b>${parseFloat(balance).toFixed(4)} TRX</b>\n\n` +
      `🔹 <b>Deposit, Withdraw, or check Payment Updates anytime.</b>`,
      {
        reply_markup: { inline_keyboard: inlineKeyboard },
        parse_mode: "HTML"
      }
    );

  } catch (error) {
    console.error("Error retrieving balance:", error);
    bot.sendMessage(
      chatId,
      "⚠️ Sorry, an error occurred while retrieving your balance. Please try again later."
    );
  }
};
