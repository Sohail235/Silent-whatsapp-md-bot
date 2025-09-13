const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const webp = require('node-webpmux');

async function s2iCommand(sock, chatId, message, sendWithChannel) {
    const msgToQuote = message;
    let target = message;

    // If replying to a sticker
    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        target = {
            key: { remoteJid: chatId, id: quotedInfo.stanzaId, participant: quotedInfo.participant },
            message: quotedInfo.quotedMessage
        };
    }

    const stickerMsg = target.message?.stickerMessage;
    if (!stickerMsg) {
        return sendWithChannel(sock, chatId, { text: '⚠️ Reply to a sticker with .toimage to convert it to image.' }, { quoted: msgToQuote });
    }

    try {
        const buffer = await downloadMediaMessage(target, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
        const img = new webp.Image();
        await img.load(buffer);
        const imgBuffer = await img.save(null);

        const tmpDir = path.join(process.cwd(), 'tmp'); if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
        const outputPath = path.join(tmpDir, `toimage_${Date.now()}.png`);
        fs.writeFileSync(outputPath, imgBuffer);

        const finalBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(chatId, { image: finalBuffer }, { quoted: msgToQuote });

        fs.unlinkSync(outputPath);
    } catch (err) {
        console.error('❌ s2i error:', err);
        await sendWithChannel(sock, chatId, { text: '❌ Failed to convert sticker to image.' }, { quoted: msgToQuote });
    }
}

module.exports = s2iCommand;