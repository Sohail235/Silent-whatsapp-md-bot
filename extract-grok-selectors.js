const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('[*] Launching browser...');
  const browser = await puppeteer.launch({
    headless: true, // Codespaces cannot show GUI
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  console.log('[*] Navigating to Grok Imagine...');
  await page.goto('https://grokimagine.ai/', { waitUntil: 'networkidle2' });

  console.log('[*] Extracting CSS selectors...');

  const selectors = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('*')];
    const uniqueSelectors = new Set();

    elements.forEach(el => {
      let selector = el.tagName.toLowerCase();
      if (el.id) selector += `#${el.id}`;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).join('.');
        if (classes) selector += `.${classes}`;
      }
      uniqueSelectors.add(selector);
    });

    return Array.from(uniqueSelectors);
  });

  fs.writeFileSync('grok-selectors.json', JSON.stringify(selectors, null, 2));
  console.log(`[*] Done! Extracted ${selectors.length} selectors.`);
  console.log('[*] Saved to grok-selectors.json');

  await browser.close();
})();
