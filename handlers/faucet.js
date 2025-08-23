const moment = require('moment-timezone');

const faucetLevels = [
  { name: "Stone", amount: 0.001000 },
  { name: "Iron", amount: 0.005000 },
  { name: "Bronze", amount: 0.010000 },
  { name: "Silver", amount: 0.030000 },
  { name: "Gold", amount: 0.125000 },
  { name: "Platinum", amount: 0.500000 },
  { name: "Diamond", amount: 2.500000 },
  { name: "Master", amount: 15.000000 }
];

const CLAIM_COOLDOWN_MINUTES = 60;

function getLevelTable(currentLevel) {
  let out = '';
  faucetLevels.forEach((tier, i) => {
    out += `${currentLevel === i + 1 ? '✅' : '◽️'} ${tier.name.padEnd(8)} — ${tier.amount.toFixed(6)} TRX\n`;
  });
  return out.trim();
}

function getFaucetScreen({ balance, lastClaimUTC, nextClaimUTC, canClaim, level }) {
  return [
    "🏆 Your Faucet Stats",
    `─────────────`,
    `💲 Balance: ${balance} credits`,
    `🕰️ Last Claim: ${lastClaimUTC ? moment.utc(lastClaimUTC).tz('Asia/Kolkata').format('D/M/YYYY, h:mm:ss a') : 'Never'}`,
    `⏰ Next Claim: ${nextClaimUTC ? moment.utc(nextClaimUTC).tz('Asia/Kolkata').format('D/M/YYYY, h:mm:ss a') : 'Anytime'}`,
    `📌 Status: ${canClaim ? '✅ Ready to claim' : '⏳ Not ready'}`,
    `─────────────`,
    `📊 Levels & Payouts`,
    getLevelTable(level)
  ].join('\n');
}

async function sendFaucetScreen(bot, db, chatId, telegramId) {
  const [users] = await db.query('SELECT id, level, wallet_balance FROM users WHERE telegram_id = ?', [telegramId]);
  if (!users.length) {
    await bot.sendMessage(chatId, '⚠️ You are not registered. Please use /start first.');
    return;
  }
  const user = users[0];
  const level = user.level || 1;
  const balance = user.wallet_balance;

  const [claims] = await db.query('SELECT claim_time FROM faucet WHERE user_id = ? LIMIT 1', [user.id]);
  const lastClaimUTC = claims.length ? claims[0].claim_time : null; // ✅ FIXED
  let canClaim = true;
  let nextClaimUTC = null;

  if (lastClaimUTC) {
    const lastUTC = new Date(lastClaimUTC);
    const now = new Date();
    const msSince = now - lastUTC;
    canClaim = msSince >= CLAIM_COOLDOWN_MINUTES * 60 * 1000;
    nextClaimUTC = new Date(lastUTC.getTime() + CLAIM_COOLDOWN_MINUTES * 60 * 1000);
  }

  await bot.sendMessage(chatId, getFaucetScreen({
    balance,
    lastClaimUTC,
    nextClaimUTC,
    canClaim,
    level
  }), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Claim', callback_data: 'faucet_claim' }]
      ]
    }
  });
}

module.exports = async (bot, db, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from?.id ?? msg.chat?.id;
  await sendFaucetScreen(bot, db, chatId, telegramId);
};

module.exports.handleCallbackQuery = async (bot, db, query) => {
  if (query.data !== 'faucet_claim') return;
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;

  const [users] = await db.query('SELECT id, level, wallet_balance FROM users WHERE telegram_id = ?', [telegramId]);
  if (!users.length) {
    await bot.answerCallbackQuery(query.id, { text: "You are not registered. Use /start.", show_alert: true });
    return;
  }
  const user = users[0];
  const level = user.level || 1;
  const payout = faucetLevels[level - 1].amount;

  // ✅ Get last claim properly
  const [claims] = await db.query('SELECT claim_time FROM faucet WHERE user_id = ? LIMIT 1', [user.id]);
  const lastClaimUTC = claims.length ? claims[0].claim_time : null; // ✅ FIXED
  let canClaim = true;
  let alertMsg = "";
  let nextClaimUTC = null;

  if (lastClaimUTC) {
    const lastUTC = new Date(lastClaimUTC);
    const now = new Date();
    const msSince = now - lastUTC;
    canClaim = msSince >= CLAIM_COOLDOWN_MINUTES * 60 * 1000;
    nextClaimUTC = new Date(lastUTC.getTime() + CLAIM_COOLDOWN_MINUTES * 60 * 1000);

    if (!canClaim) {
      const remainingMs = nextClaimUTC - now;
      const mins = Math.floor(remainingMs / (60 * 1000));
      const secs = Math.floor((remainingMs % (60 * 1000)) / 1000);
      const nextClaimIST = moment.utc(nextClaimUTC).tz('Asia/Kolkata').format('h:mm:ss a');
      alertMsg = `⏳ Next claim in ${mins}m ${secs < 10 ? '0' : ''}${secs}s (at ${nextClaimIST} IST).`;
    }
  }

  if (!canClaim) {
    await bot.answerCallbackQuery(query.id, { text: alertMsg || "⏳ You must wait to claim again.", show_alert: true });
    return;
  }

  try {
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [payout, user.id]);
    await db.query(
      `INSERT INTO faucet (user_id, telegram_id, claim_amount, user_level, claim_time)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          claim_amount = VALUES(claim_amount),
          user_level = VALUES(user_level),
          claim_time = VALUES(claim_time),
          telegram_id = VALUES(telegram_id)`,
      [user.id, telegramId, payout, level, new Date()]
    );

    await bot.answerCallbackQuery(query.id, { text: `🎉 Success! You claimed ${payout} TRX. Come back in 1 hour.`, show_alert: true });

  } catch (err) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Error claiming. Please try again.", show_alert: true });
  }
};

module.exports.sendFaucetScreen = sendFaucetScreen;
