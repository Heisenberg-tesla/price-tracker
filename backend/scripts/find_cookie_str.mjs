import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://demo.inelabteamdev.com/product/915', { waitUntil: 'networkidle' });

  const html = await page.content();
  console.log('Includes cookie-overlay?:', html.includes('cookie-overlay'));
  if (html.includes('cookie-overlay')) {
    const idx = html.indexOf('cookie-overlay');
    console.log(html.substring(Math.max(0, idx - 100), Math.min(html.length, idx + 400)));
  }

  await browser.close();
}

main().catch(console.error);
