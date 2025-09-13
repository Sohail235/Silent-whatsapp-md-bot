/**
 * group-list.js
 * Lists every WhatsApp group the bot is in.
 * Usage: .grouplist
 */
module.exports = async function GroupList(sock, fromJid, m) {
  try {
    // --- preferred: direct API call ---
    let groups = [];
    if (typeof sock.groupFetchAllParticipating === 'function') {
      const fetched = await sock.groupFetchAllParticipating();
      // fetched is an object: { groupId: { id, subject, ... }, ... }
      groups = Object.values(fetched);
    }

    // --- fallback if that call is missing/disabled ---
    if (!groups.length && sock.chats) {
      groups = Object.values(sock.chats).filter(c => c.id && c.id.endsWith('@g.us'));
    }

    if (!groups.length) {
      await sock.sendMessage(fromJid, { text: '🤷‍♂️ I’m not in any groups.' }, { quoted: m });
      return;
    }

    // Build output
    let msg = `📋 *Groups I’m In* (${groups.length})\n\n`;
    groups.forEach((g, i) => {
      const name = g.subject || g.name || 'Unnamed Group';
      msg += `${i + 1}. ${name}\n   ID: ${g.id}\n\n`;
    });

    await sock.sendMessage(fromJid, { text: msg.trim() }, { quoted: m });
  } catch (err) {
    console.error('group-list.js error:', err);
    await sock.sendMessage(
      fromJid,
      { text: `❌ Could not fetch group list: ${err.message}` },
      { quoted: m }
    );
  }
};