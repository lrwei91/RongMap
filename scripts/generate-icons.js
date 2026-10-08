// Deterministic SVG rasterization using the project's existing browser tooling.
// Run: node scripts/generate-icons.js (requires the Playwright Chromium binary).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'public/icons/app-source.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [size, file, maskable] of [
      [180, 'apple-touch-icon.png', false],
      [192, 'icons/app-192.png', false],
      [512, 'icons/app-512.png', false],
      [512, 'icons/app-maskable-512.png', true]
    ]) {
      // Scale around the center: all essential artwork fits the mask's safe circle.
      const svg = maskable ? source.replace('id="mark"', 'id="mark" transform="translate(32 32) scale(.72) translate(-32 -32)"') : source;
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#ffe28a}svg{display:block;width:100%;height:100%}</style>${svg}`);
      await page.screenshot({ path: path.join(root, 'public', file), omitBackground: false });
      console.log(`Generated ${file} (${size} × ${size})`);
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
