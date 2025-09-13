// check.js
// Batch WhatsApp registration checker using Baileys
// Author: Sohail235

'use strict';

/**
 * Check WhatsApp registration for one number.
 * @param {object} sock - Baileys socket instance
 * @param {string} number - Phone number (with country code, no symbols)
 * @returns {Promise<{number: string, registered: boolean, exists: boolean}>}
 */
async function checkNumberWhatsapp(sock, number) {
    const jid = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    try {
        const resultArr = await sock.onWhatsApp(jid);
        // resultArr is an array of objects: [{jid, exists, isBusiness, ...}]
        const exists = Array.isArray(resultArr) && resultArr[0]?.exists;
        return {
            number,
            registered: !!exists,
            exists: !!exists
        };
    } catch (err) {
        return {
            number,
            registered: false,
            exists: false
        };
    }
}

/**
 * Batch handler for .check command in bot.js
 * @param {object} sock - WhatsApp socket
 * @param {string} from - JID to reply to
 * @param {object} m - Message object
 * @param {string[]} numbers - Array of numbers to check
 * @param {function} sendWithChannel - Reply function
 */
async function checkCommand(sock, from, m, numbers, sendWithChannel) {
    if (!Array.isArray(numbers) || numbers.length === 0) {
        await sendWithChannel(sock, from, { text: '⚠️ Usage: .check <number1> <number2> ...' }, { quoted: m });
        return;
    }

    // Remove duplicates, empty entries, and trim spaces
    const uniqueNumbers = [...new Set(numbers.map(n => n.trim()).filter(Boolean))];
    const results = await Promise.all(uniqueNumbers.map(num => checkNumberWhatsapp(sock, num)));

    const replyLines = [
        '╔══❀•°❀°•❀══╗',
        '║ 𓆩🩸 WHATSAPP REG CHECK 🩸𓆪 ║',
        '╚══❀•°❀°•❀══╝'
    ];

    for (const r of results) {
        replyLines.push(`${r.number}: ${r.registered ? "✅ Registered" : "❌ Not Registered"}`);
    }

    await sendWithChannel(sock, from, { text: replyLines.join('\n') }, { quoted: m });
}

module.exports = checkCommand;