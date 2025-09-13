// take.js - Change sticker pack name & author
const { default: makeSticker } = require('wa-sticker-formatter');

async function takeSticker(sock, from, m, args) {
    try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const type = quoted ? Object.keys(quoted)[0] : Object.keys(m.message)[0];

        if (!(m.message.stickerMessage || quoted?.stickerMessage)) {
            await sock.sendMessage(from, { text: '⚠️ Reply to a *sticker* with `.take pack|author`' }, { quoted: m });
            return;
        }

        if (!args[1]) {
            await sock.sendMessage(from, { text: '⚠️ Usage: `.take PackName|Author`' }, { quoted: m });
            return;
        }

        const input = args.slice(1).join(" ");
        const [pack, author] = input.split("|");

        const mediaMessage = m.message.stickerMessage || quoted?.stickerMessage;
        const buffer = await sock.downloadMediaMessage({ message: mediaMessage });

        if (!buffer) {
            await sock.sendMessage(from, { text: '❌ Failed to download sticker.' }, { quoted: m });
            return;
        }

        const sticker = new makeSticker(buffer, {
            pack: pack || "Silent Bot",
            author: author || "🩸ᏕᎥᏝᏋᏁᏖ ᏦᎥᏝᏝᏕ🩸",
            type: "default",
            quality: 70
        });

        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });

    } catch (err) {
        console.error("❌ TAKE Error:", err);
        await sock.sendMessage(from, { text: "❌ Failed to edit sticker metadata." }, { quoted: m });
    }
}

module.exports = takeSticker;