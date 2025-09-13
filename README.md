# Silent-whatsapp-md-bot

**This project is for educational purposes only. Use it at your own risk.**
## GET THE SESSION ID FROM HERE AND PASTE IT IN session/creds.json and run the bot.js 
https://pair.davidcyril.name.ng/pair
## if there comes any issue just contact me here 
https://t.me/Silent000666
## Overview

Silent-whatsapp-md-bot is a production-ready WhatsApp bot built using [Baileys](https://github.com/whiskeysockets/baileys) for WhatsApp Web multi-device. The bot focuses on privacy, utility, and extensibility, providing a robust set of features for both group and private chats.

## Features

- **Privacy Controls**
  - `.public`, `.private`: Switch bot visibility modes
- **Anti-Delete**
  - `.antion`, `.antioff`, `.antistatus`, `.antidelete`: Prevents deletion of messages and statuses, recovers revoked content, and forwards to the owner
- **Owner Controls**
  - `.block`, `.unblock`: Owner-only commands for user management
- **Utilities**
  - `.ping`, `.runtime`/`.uptime`: Check bot status and uptime
  - `.weather <city>`: Fetch weather information
- **JID Tools**
  - `.jidinfo`, `.extractjid`, `.linkjid`: WhatsApp user and group identifier utilities
- **APIs**
  - `.ipme`, `.ipgeo <ip>`: IP info and geolocation
  - `.randomuser <n>`: Generate random user profiles
  - `.universities <country>`: List universities by country
  - `.whois <domain>`: Domain WHOIS lookup
  - `.agify <name>`, `.genderize <name>`, `.nationalize <name>`: Predict age, gender, and nationality from name
- **Instagram Tools**
  - `.insta`: Download media
  - `.iginfo <username>`: Get Instagram profile info
- **Media Commands**
  - `.cat [gif] [breed]`: Fetch cat images/gifs by breed
  - `.s2i`: Convert sticker to image
  - `.sm`: Sticker maker
- **AI & Generation**
  - `.gpt`: ChatGPT integration (implementation-dependent)
  - `.t2v [--dur <sec>] [prompt]`: Freepik text-to-video (image reply only)
  - `.pimg <prompt>`: Pollinations image generation
- **YouTube Download**
  - `.ytv <query>`: Download MP4 by search
  - `.yta <query>`: Download MP3 by search

## Security

- All secrets and API keys are managed through `.env`. Freepik keys utilize internal rotation logic.
- Owner number is normalized and used for anti-delete forward and privileged actions.

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/Sohail235/Silent-whatsapp-md-bot.git
   cd Silent-whatsapp-md-bot
   npm install
   ```
2. Add your credentials and API keys to a `.env` file (see module docs for required keys).
3. Run the bot:
   ```bash
   node bot.js
   ```

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Disclaimer

This is only for educational purposes. Use it at your own risk. The author is not responsible for any misuse or damages.

## Author

[Sohail235](https://github.com/Sohail235)
