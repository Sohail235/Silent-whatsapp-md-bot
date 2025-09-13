/**
 * Genderize API wrapper module
 * Usage: handleGenderize(sock, chatId, message, name, sendWithChannel)
 * Responds in chat with estimated gender for the given name.
 *
 * Example: .genderize Alice
 *
 * Dependencies: axios (npm i axios)
 */

const axios = require('axios');

/**
 * Main handler function for .genderize command
 * @param {object} sock - Baileys socket instance
 * @param {string} chatId - WhatsApp chat JID
 * @param {object} message - Baileys message object
 * @param {string} name - Name to check gender for
 * @param {function} sendWithChannel - Function to send message, with channel context
 */
async function handleGenderize(sock, chatId, message, name, sendWithChannel) {
  name = String(name || '').trim();
  if (!name) {
    await sendWithChannel(sock, chatId, { text: 'Usage:\n.genderize <name>\nExample: .genderize Alice' }, { quoted: message });
    return;
  }

  try {
    const url = `https://api.genderize.io?name=${encodeURIComponent(name)}`;
    const { data } = await axios.get(url);
    const gender = data.gender ? data.gender : 'unknown';
    const probability = data.probability ? `${(parseFloat(data.probability) * 100).toFixed(1)}%` : 'N/A';
    const count = data.count ? data.count : 'N/A';

    const reply =
      `🚻 Genderize\n` +
      `• Name: ${name}\n` +
      `• Gender: ${gender}\n` +
      `• Probability: ${probability}\n` +
      `• Sample Size: ${count}\n` +
      `Source: api.genderize.io`;

    await sendWithChannel(sock, chatId, { text: reply }, { quoted: message });
  } catch (e) {
    await sendWithChannel(sock, chatId, { text: `❌ Genderize API error: ${e?.message || e}` }, { quoted: message });
  }
}

module.exports = { handleGenderize };