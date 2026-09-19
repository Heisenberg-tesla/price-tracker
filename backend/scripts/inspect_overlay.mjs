import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://demo.inelabteamdev.com/product/915', { waitUntil: 'networkidle' });

  const overlayHtml = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const overlays = all.filter(el => {
      const style = window.getComputedStyle(el);
      const isFixed = style.position === 'fixed' || style.position === 'sticky';
      const hasZIndex = parseInt(style.zIndex, 10) > 10;
      const cName = typeof el.className === 'string' ? el.className : (el.className ? String(el.className) : '');
      return (isFixed && hasZIndex) || cName.includes('overlay') || cName.includes('banner') || cName.includes('modal') || cName.includes('cookie');
    });

    return overlays.map(el => ({
      tagName: el.tagName,
      className: el.className,
      id: el.id,
      outerHTML: el.outerHTML.slice(0, 300),
    }));
  });

  console.log('OVERLAYS FOUND:');
  console.log(JSON.stringify(overlayHtml, null, 2));

  await browser.close();
}

main().catch(console.error);
