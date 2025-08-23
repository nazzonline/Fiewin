const moment = require('moment-timezone');
const userSelections = {};
const betLock = {};

// Load bet amounts from ENV (comma-separated, e.g. "0.001,0.05,0.1,10,50,100")
const betAmounts = process.env.BET_AMOUNTS
  ? process.env.BET_AMOUNTS.split(',').map(a => parseFloat(a.trim())).filter(a => !isNaN(a) && a > 0)
  : [0.001, 0.05, 0.1, 10, 50, 100]; // fallback defaults

// Inline keyboard for bet selection
function getKeyboard(selected = null) {
  const buttons = betAmounts.map(amount => ({
    text: selected === amount ? `Bet ${amount} ✅` : `Bet ${amount}`,
    callback_data: `bet_${amount}`
  }));

  // Arrange buttons in rows of 3
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }

  rows.push([{ text: "⚽ Place Bet!", callback_data: "place_bet" }]);

  return { inline_keyboard: rows };
}

// ✅ Helper to pay referral commission (without referrals table insert)
async function payReferralCommission(db, userId, betAmount, bot) {
  try {
    const [userRow] = await db.query('SELECT refer_id FROM users WHERE id = ?', [userId]);
    const referId = userRow.length ? userRow[0].refer_id : null;

    if (referId) {
      const [refRows] = await db.query('SELECT id, telegram_id FROM users WHERE id = ?', [referId]);
      if (refRows.length) {
        const refUser = refRows[0];
        const commission = Number((betAmount * 0.10).toFixed(6)); // supports decimals

        await db.query(
          "UPDATE users SET wallet_balance = wallet_balance + ?, referral_earnings = referral_earnings + ? WHERE id = ?",
          [commission, commission, refUser.id]
        );

        await bot.sendMessage(refUser.telegram_id, `🎉 You earned ${commission} from your referral's bet!`);
      }
    }
  } catch (err) {
    console.error('Error updating referral rewards:', err);
  }
}

// Main Game Handler
async function mainGame(bot, db, msg) {
  const chatId = msg.chat.id;
  userSelections[msg.from.id] = null;
  betLock[msg.from.id] = false;

  await bot.sendMessage(
    chatId,
    "⚽ Football Penalty Game:\nChoose your bet amount, then press Place Bet!",
    { reply_markup: getKeyboard(null) }
  );
}

// Callback Query Handler
async function handleCallbackQuery(bot, db, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const messageId = query.message.message_id;
  const username = query.from.username ? '@' + query.from.username : '(no username)';
  const channel = process.env.RESULTS_CHANNEL;

  if (betLock[telegramId] && query.data === "place_bet") {
    await bot.answerCallbackQuery(query.id, { text: "Wait for the current round to finish!", show_alert: true });
    return;
  }

  if (query.data.startsWith("bet_")) {
    const amount = parseFloat(query.data.split("_")[1]);
    if (userSelections[telegramId] === amount) {
      await bot.answerCallbackQuery(query.id, { text: "Already selected!", show_alert: true });
      return;
    }
    userSelections[telegramId] = amount;
    await bot.editMessageReplyMarkup(getKeyboard(amount), { chat_id: chatId, message_id: messageId });
    await bot.answerCallbackQuery(query.id, { text: `Selected bet: ${amount}` });
    return;
  }

  if (query.data === "place_bet") {
    const selectedAmount = userSelections[telegramId];
    if (!selectedAmount) {
      await bot.answerCallbackQuery(query.id, { text: "Choose your bet amount first!", show_alert: true });
      return;
    }
    betLock[telegramId] = true;

    let user;
    try {
      const [rows] = await db.query("SELECT id, wallet_balance FROM users WHERE telegram_id = ?", [telegramId]);
      if (!rows.length) {
        await bot.answerCallbackQuery(query.id, { text: "Please register with /start first.", show_alert: true });
        betLock[telegramId] = false;
        return;
      }
      user = rows[0];
      if (user.wallet_balance < selectedAmount) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Insufficient balance.", show_alert: true });
        betLock[telegramId] = false;
        return;
      }
    } catch (error) {
      await bot.answerCallbackQuery(query.id, { text: "Error retrieving balance.", show_alert: true });
      betLock[telegramId] = false;
      return;
    }

    const newBalance = user.wallet_balance - selectedAmount;
    await db.query(
      "UPDATE users SET wallet_balance = ?, total_wagered = total_wagered + ? WHERE id = ?",
      [newBalance, selectedAmount, user.id]
    );

    await payReferralCommission(db, user.id, selectedAmount, bot);
    await bot.deleteMessage(chatId, messageId);

    const diceMsg = await bot.sendDice(chatId, { emoji: "⚽" });

    setTimeout(async () => {
      const value = diceMsg.dice.value;
      const won = value === 3 || value === 4 || value === 5;
      const winAmount = won ? selectedAmount * 2 : 0;
      const resultText = won ? 'GOAL' : 'Missed';
      const timeIST = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      if (won) {
        await db.query(
          "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
          [winAmount, user.id]
        );
      }

      await db.query(
        "INSERT INTO games (user_id, bet_amount, result, win, played_at) VALUES (?, ?, ?, ?, ?)",
        [user.id, selectedAmount, won ? "won" : "lose", won ? 1 : 0, new Date()]
      );

      await bot.sendMessage(
        chatId,
        won
          ? `🥅 GOAL!\n🏆 You win ${winAmount}! New balance: ${newBalance + winAmount}`
          : `🥅 Missed!\n😞 You lost ${selectedAmount}. New balance: ${newBalance}`
      );

      if (channel) {
        await bot.sendMessage(
          channel,
          `⚽️ Football Game Log\n` +
          `Result: ${resultText}\n` +
          `Bet: ${selectedAmount}\n` +
          `User: ID ${telegramId} (${username})\n` +
          `Win: ${won ? 'YES' : 'NO'}\n` +
          `Date: ${timeIST}`
        );
      }

      userSelections[telegramId] = null;
      betLock[telegramId] = false;
      await bot.sendMessage(
        chatId,
        "⚽ Football Penalty Game:\nChoose your bet amount, then press Place Bet!",
        { reply_markup: getKeyboard(null) }
      );
    }, 2000);
    return;
  }
}

module.exports = {
  main: mainGame,
  handleCallbackQuery
};
