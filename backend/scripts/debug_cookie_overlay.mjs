import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://demo.inelabteamdev.com/product/915', { waitUntil: 'networkidle' });

  // Move mouse
  const priceBlock = await page.$('.price-block');
  const box = await priceBlock.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  for (let i = 0; i < 15; i++) {
    await page.mouse.move(box.x + 30 + i * 15, box.y + 30 + ((i % 5) * 6));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(700);

  const info = await page.evaluate(() => {
    const el = document.querySelector('.cookie-overlay');
    if (!el) return 'NO_COOKIE_OVERLAY';
    const style = window.getComputedStyle(el);
    return {
      outerHTML: el.outerHTML,
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      top: style.top,
      left: style.left,
      width: style.width,
      height: style.height,
      pointerEvents: style.pointerEvents
    };
  });

  console.log('COOKIE OVERLAY DETAILS:');
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
