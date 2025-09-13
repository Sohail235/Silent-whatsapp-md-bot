const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function viewonceCommand(sock, chatId, message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    // your private number JID
    const myJid = "923281262584@s.whatsapp.net";

    if (quotedImage?.viewOnce) {
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        await sock.sendMessage(myJid, {
            image: buffer,
            fileName: 'media.jpg',
            caption: (quotedImage.caption || '') + '\n\n> SAVED BY SOHAIL KHAN 🧞'
        });
    } else if (quotedVideo?.viewOnce) {
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        await sock.sendMessage(myJid, {
            video: buffer,
            fileName: 'media.mp4',
            caption: (quotedVideo.caption || '') + '\n\n> SAVED BY SOHAIL KHAN 🧞'
        });
    } else {
        await sock.sendMessage(chatId, {
            text: '❌ Please reply to a view-once image or video.'
        }, { quoted: message });
    }
}

module.exports = viewonceCommand;
