
// channel.js – list all @newsletter channels the bot account follows

/**
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} fromJid - JID of the chat where the command was sent
 * @param {import('@whiskeysockets/baileys').proto.WebMessageInfo} m - full message object
 */
module.exports = async function ChannelList(sock, fromJid, m) {
  try {
    // get all chats currently stored
    const allChats = await sock.groupFetchAllParticipating().catch(() => ({}));
    // sock.chats also contains channels; we filter by newsletter type
    const all = Object.values(sock.chats || {});
    const newsletters = all.filter(c =>
      c.id && c.id.endsWith('@newsletter')
    );

    if (!newsletters.length) {
      await sock.sendMessage(fromJid, { text: '🤷‍♂️ No newsletters found.' }, { quoted: m });
      return;
    }

    // Build pretty list
    const lines = newsletters.map((c, i) =>
      `${i + 1}. ${c.name || c.subject || c.id.replace('@newsletter', '')}`
    );

    const msg =
      `📰 *Newsletters I Follow*\n` +
      lines.join('\n');

    await sock.sendMessage(fromJid, { text: msg }, { quoted: m });

  } catch (err) {
    console.error('ChannelList error:', err);
    await sock.sendMessage(fromJid, { text: `❌ Error: ${err.message}` }, { quoted: m });
  }
};