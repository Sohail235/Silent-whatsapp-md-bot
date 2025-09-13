async function getppCommand(sock, chatId, message, jid, rawNumber) {
    try {
        const ppUrl = await sock.profilePictureUrl(jid, 'image');
        await sock.sendMessage(chatId, {
            image: { url: ppUrl },
            caption: `> BY DEVIL ${rawNumber}`
        }, { quoted: message });
    } catch (e) {
        await sock.sendMessage(chatId, {
            text: `❌ Could not fetch profile picture for ${rawNumber}`
        }, { quoted: message });
    }
}

module.exports = getppCommand;
