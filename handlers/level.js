const levelRequirements = [
  { level: 2,  minWager: 100,    bonus: 0.005000,  name: "🥉 Iron" },
  { level: 3,  minWager: 500,    bonus: 0.02,      name: "🥉 Bronze" },
  { level: 4,  minWager: 1500,   bonus: 0.05,      name: "🥈 Silver" },
  { level: 5,  minWager: 5000,   bonus: 0.15,      name: "🥇 Gold" },
  { level: 6,  minWager: 15000,  bonus: 0.5,       name: "💎 Platinum" },
  { level: 7,  minWager: 50000,  bonus: 2,         name: "💠 Diamond" },
  { level: 8,  minWager: 200000, bonus: 10,        name: "👑 Master" },
];

module.exports = async (bot, db, telegramId, chatId) => {
  // Fetch user
  const [users] = await db.query(
    'SELECT id, level, total_wagered, wallet_balance FROM users WHERE telegram_id = ?', 
    [telegramId]
  );
  if (!users.length) return false; // Not registered

  let user = users[0];
  let updated = false;

  for (const req of levelRequirements) {
    if (user.level < req.level && user.total_wagered >= req.minWager) {
      // User qualifies for level up
      user.level = req.level;
      updated = true;

      await db.query(
        'UPDATE users SET level = ?, wallet_balance = wallet_balance + ? WHERE id = ?', 
        [user.level, req.bonus, user.id]
      );

      const nextLevel = levelRequirements.find(lr => lr.level === req.level + 1);

      // ✨ Nicely formatted message
      await bot.sendMessage(
        chatId,
        `🎉 <b>Level Up!</b>\n\n` +
        `🏆 <b>Congratulations</b>, you’ve reached:\n` +
        `➡️ <b>Level ${req.level} – ${req.name}</b>\n\n` +
        `💰 <b>Bonus Awarded:</b> +${req.bonus} TRX\n` +
        `📊 <b>Total Wagered:</b> ${user.total_wagered}\n\n` +
        (nextLevel 
          ? `🔓 <b>Next Level:</b> ${nextLevel.name} (at ${nextLevel.minWager} wagered)` 
          : `🔥 You’ve reached the <b>MAX Level</b>! 👑`
        ),
        { parse_mode: "HTML" }
      );
    }
  }
  return updated;
};
