import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://demo.inelabteamdev.com/product/915', { waitUntil: 'networkidle' });

  // Move mouse and scroll
  await page.mouse.move(500, 400);
  await page.mouse.move(520, 420);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(2000);

  const cookieEl = await page.evaluate(() => {
    const el = document.querySelector('.cookie-overlay, [class*="cookie"]');
    if (!el) return 'NOT_FOUND';
    return {
      outerHTML: el.outerHTML,
      text: el.textContent,
      buttons: Array.from(el.querySelectorAll('button')).map(b => ({
        text: b.textContent,
        className: b.className,
        outerHTML: b.outerHTML
      }))
    };
  });

  console.log('COOKIE OVERLAY RESULT:');
  console.log(JSON.stringify(cookieEl, null, 2));

  await browser.close();
}

main().catch(console.error);
