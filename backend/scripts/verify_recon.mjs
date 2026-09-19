import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const VERIFY_DIR = path.resolve('../docs/RECON_VERIFICATION');
if (!fs.existsSync(VERIFY_DIR)) {
  fs.mkdirSync(VERIFY_DIR, { recursive: true });
}

async function runVerification() {
  console.log('Launching browser with --disable-extensions...');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
    });
  } catch (e) {
    console.log('Default chromium launch failed, falling back to chrome channel...');
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
    });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  console.log('Navigating to https://demo.inelabteamdev.com/product/915 ...');
  await page.goto('https://demo.inelabteamdev.com/product/915', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for product details to render
  await page.waitForSelector('h1, .detail-title', { state: 'visible', timeout: 10000 });
  console.log('Base page rendered.');

  // Dump price block before reveal
  const priceBlockBefore = await page.$('.price-block');
  if (priceBlockBefore) {
    const htmlBefore = await priceBlockBefore.evaluate((el) => el.outerHTML);
    fs.writeFileSync(path.join(VERIFY_DIR, 'price_main_before.html'), htmlBefore, 'utf-8');
    console.log('Saved price_main_before.html');
  }

  await page.screenshot({ path: path.join(VERIFY_DIR, 'before_reveal.png'), fullPage: false });
  console.log('Saved before_reveal.png');

  // Locate the price container for hover telemetry
  const priceBlock = await page.$('.price-block');
  if (!priceBlock) {
    throw new Error('Price block element not found on page');
  }

  const box = await priceBlock.boundingBox();
  console.log('Price block bounding box:', box);

  if (!box) {
    throw new Error('Could not get bounding box for price block');
  }

  // Hover across the price box in discrete steps (meeting minMoves >= 8)
  console.log('Simulating discrete mouse movement over price block...');
  await page.mouse.move(box.x + 30, box.y + 30);
  for (let i = 0; i < 15; i++) {
    await page.mouse.move(box.x + 30 + i * 15, box.y + 30 + ((i % 5) * 6));
    await page.waitForTimeout(60);
  }

  // Wait past minDwellMs (600ms)
  await page.waitForTimeout(700);

  // Check reveal button state
  console.log('Checking reveal button disabled state...');
  const revealBtn = page.locator('button[aria-label="Reveal price"]');
  await revealBtn.waitFor({ state: 'visible', timeout: 5000 });

  let isEnabled = false;
  for (let i = 0; i < 30; i++) {
    const disabled = await revealBtn.getAttribute('disabled');
    if (disabled === null) {
      isEnabled = true;
      console.log(`Reveal button is enabled (attempt ${i + 1})`);
      break;
    }
    // Additional gentle movements if still disabled
    await page.mouse.move(box.x + 40 + (i % 8) * 10, box.y + 35 + (i % 4) * 5);
    await page.waitForTimeout(100);
  }

  if (!isEnabled) {
    throw new Error('Reveal button never enabled within dwell timeout');
  }

  // In-page click retry loop (handling jitter drops)
  console.log('Clicking reveal button with trusted Playwright click...');
  let revealed = false;
  for (let clickAttempt = 1; clickAttempt <= 5; clickAttempt++) {
    console.log(`Click attempt ${clickAttempt}...`);
    // Scroll element into view if needed and click with force if an overlay intercepts
    try {
      await revealBtn.click({ timeout: 4000 });
    } catch (clickErr) {
      console.warn(`Click failed: ${clickErr.message}. Attempting click with force...`);
      await revealBtn.click({ force: true });
    }

    // Wait for terminal price state (.price-success or .price-error)
    try {
      await page.waitForSelector('.price-success, .price-error', { timeout: 4000 });
      revealed = true;
      console.log('Terminal price state reached!');
      break;
    } catch (e) {
      console.log(`No state change after click ${clickAttempt}, retrying...`);
      await page.waitForTimeout(600);
    }
  }

  if (!revealed) {
    throw new Error('Price reveal never reached terminal state after 5 click attempts');
  }

  // Settle any DOM updates
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(VERIFY_DIR, 'after_reveal.png'), fullPage: false });
  console.log('Saved after_reveal.png');

  // Dump outerHTML of .price-main
  const priceMainEl = await page.$('.price-main');
  let htmlAfter = '';
  if (priceMainEl) {
    htmlAfter = await priceMainEl.evaluate((el) => el.outerHTML);
    fs.writeFileSync(path.join(VERIFY_DIR, 'price_main_after.html'), htmlAfter, 'utf-8');
    console.log('Saved price_main_after.html');
  } else {
    // If .price-main not found, dump .price-block
    const pb = await page.$('.price-block');
    if (pb) {
      htmlAfter = await pb.evaluate((el) => el.outerHTML);
      fs.writeFileSync(path.join(VERIFY_DIR, 'price_main_after.html'), htmlAfter, 'utf-8');
      console.log('Saved price_main_after.html (.price-block fallback)');
    }
  }

  // Detailed DOM inspection of .price-main
  const inspection = await page.evaluate(() => {
    const pm = document.querySelector('.price-main');
    if (!pm) {
      const pb = document.querySelector('.price-block');
      return { error: '.price-main not found', blockHTML: pb ? pb.outerHTML : null };
    }

    const children = Array.from(pm.children).map((child, index) => {
      const style = window.getComputedStyle(child);
      return {
        index,
        tagName: child.tagName,
        className: child.className,
        id: child.id,
        ariaHidden: child.getAttribute('aria-hidden'),
        display: style.display,
        visibility: style.visibility,
        textDecoration: style.textDecoration,
        textContent: child.textContent,
        childSpans: Array.from(child.querySelectorAll('span')).map((s) => ({
          text: s.textContent,
          className: s.className,
        })),
        dataset: Object.assign({}, child.dataset),
        isHoneypot:
          child.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          child.classList.contains('price-value') ||
          child.dataset.price === 'true',
        isStrikethroughMRP:
          style.textDecoration.includes('line-through') ||
          child.classList.contains('mrp'),
        isBadge:
          child.textContent?.includes('% off') ||
          child.classList.contains('badge'),
      };
    });

    return {
      outerHTML: pm.outerHTML,
      children,
    };
  });

  console.log('\n--- VERIFICATION INSPECTION SUMMARY ---');
  console.log(JSON.stringify(inspection, null, 2));

  fs.writeFileSync(
    path.join(VERIFY_DIR, 'inspection_summary.json'),
    JSON.stringify(inspection, null, 2),
    'utf-8'
  );

  await browser.close();
  console.log('\nVerification script completed successfully.');
}

runVerification().catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
