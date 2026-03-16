#!/usr/bin/env node
/**
 * Generate 1200x1200 app icon for Shopify App Store
 *
 * Shopify icon guidelines:
 *   - 1200x1200 PNG, no rounded corners (Shopify rounds automatically)
 *   - Icon element fills 10/16 to 12/16 of the canvas (750px–900px)
 *   - 1/16 margin (75px) around edges minimum
 *   - Bold colors, simple, recognizable at small sizes
 *   - No text, no Shopify trademarks
 *
 * Design: Chat bubble with centered shopping bag — "shop chat agent"
 */
import sharp from 'sharp';

const SIZE = 1200;
const C = SIZE / 2; // center = 600

const BG = '#5046e4';
const WHITE = '#ffffff';

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}" />

  <!-- Chat bubble: centered in canvas, fills ~11/16 -->
  <!-- Bubble body -->
  <rect x="260" y="195" width="680" height="520" rx="80" ry="80" fill="${WHITE}" />
  <!-- Bubble tail — bottom-left -->
  <polygon points="340,715 440,715 280,870" fill="${WHITE}" />

  <!-- Shopping bag — centered inside the bubble body -->
  <!-- Bubble center is at (600, 455). Bag is drawn centered there. -->
  <g transform="translate(600, 435)" fill="none" stroke="${BG}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
    <!-- Bag body -->
    <rect x="-135" y="-30" width="270" height="240" rx="20" ry="20" />
    <!-- Bag handles -->
    <path d="M-70,-30 C-70,-130 70,-130 70,-30" />
  </g>
</svg>
`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile('app-icon.png');

console.log('Generated app-icon.png (1200x1200)');
