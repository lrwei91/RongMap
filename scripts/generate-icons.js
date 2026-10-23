// Deterministic SVG rasterization using the project's existing browser tooling.
// Run: node scripts/generate-icons.js (requires the Playwright Chromium binary).
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'public/icons/app-source.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [size, file, maskable] of [
      [32, 'favicon-32.png', false],
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
    // Root fallbacks serve clients that discover icons without following the HTML link.
    for (const target of ['icons/apple-touch-icon-180.png', 'apple-touch-icon-precomposed.png']) {
      fs.copyFileSync(path.join(root, 'public/apple-touch-icon.png'), path.join(root, 'public', target));
    }
    // ICO container with a PNG entry; no additional image dependency is needed.
    const png = fs.readFileSync(path.join(root, 'public/favicon-32.png'));
    const ico = Buffer.alloc(22);
    ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
    ico[6] = 32; ico[7] = 32; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
    ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(root, 'public/favicon.ico'), Buffer.concat([ico, png]));
    const versioned = (url) => {
      const file = url.split('?')[0];
      const hash = createHash('sha256').update(fs.readFileSync(path.join(root, 'public', file))).digest('hex').slice(0, 12);
      return `${file}?v=${hash}`;
    };
    const manifestPath = path.join(root, 'public/manifest.webmanifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: versioned(icon.src) }));
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const htmlPath = path.join(root, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(/href="([^"?]+(?:\.png|\.ico|\.webmanifest))(?:\?[^"]*)?"/g, (_, url) => `href="${versioned(url)}"`);
    fs.writeFileSync(htmlPath, html);
    console.log('Updated icon fallbacks and content-based cache versions.');
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
