const moment = require('moment-timezone');
const { mainKeyboard } = require('../keyboard');

// Helper: extract referId from start payload
function extractReferId(text) {
  // Only works for /start or /start ref123456789
  if (!text) return null;
  const match = text.trim().match(/^\/start\s+ref(\d+)$/i);
  return match ? match[1] : null;
}

module.exports = async (bot, db, msg) => {
  try {
    const chatId = msg.chat.id;
    const from = msg.from;

    const joinedDateIST = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    const telegramId = from.id;
    const username = from.username || null;
    const firstName = from.first_name || null;
    const lastName = from.last_name || null;

    // Extract referId from start parameter, if present
    const referTelegramId = extractReferId(msg.text);

    // Look up referrer's user id (if any and not self)
    let referUserId = null;
    if (referTelegramId && referTelegramId != telegramId) {
      const [refUsers] = await db.query("SELECT id FROM users WHERE telegram_id = ?", [referTelegramId]);
      if (refUsers.length) {
        referUserId = refUsers[0].id;
      }
    }

    // Check if user already exists
    const [users] = await db.query("SELECT id FROM users WHERE telegram_id = ?", [telegramId]);

    if (!users.length) {
      // Insert new user with refer_id if set
      await db.query(
        `INSERT INTO users 
        (telegram_id, username, first_name, last_name, joined_date, wallet_balance, total_wagered, level, refer_id) 
        VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?)`,
        [telegramId, username, firstName, lastName, joinedDateIST, referUserId]
      );
      await bot.sendMessage(chatId, `Welcome, ${firstName || ''}! Your account has been registered.`, mainKeyboard);
    } else {
      // Update their info if changed
      await db.query(
        `UPDATE users SET
          username = ?,
          first_name = ?,
          last_name = ?
        WHERE telegram_id = ?`,
        [username, firstName, lastName, telegramId]
      );
      await bot.sendMessage(chatId, `Hi, ${firstName || ''}! You are already registered.`, mainKeyboard);
    }
  } catch (error) {
    console.error('Error in /start handler:', error);
  }
};
