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

// We want the icon element to fill ~11/16ths of 1200px = 825px
const BUBBLE_WIDTH = 850;
const BUBBLE_HEIGHT = 650;
const BUBBLE_RX = 100;
const TAIL_HEIGHT = 150;

const BUBBLE_X = C - BUBBLE_WIDTH / 2;
const BUBBLE_Y = C - (BUBBLE_HEIGHT + TAIL_HEIGHT) / 2;

// Shopping bag dimensions
// Body: 340x300. Handle height: 130. Total height: ~430.
// We center the entire bag (including handles) inside the bubble body.
const BAG_Y_OFFSET = 35; // (250 - 180) / 2 to center the handle+body bounding box

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}" />

  <!-- Chat bubble body -->
  <rect x="${BUBBLE_X}" y="${BUBBLE_Y}" width="${BUBBLE_WIDTH}" height="${BUBBLE_HEIGHT}" rx="${BUBBLE_RX}" ry="${BUBBLE_RX}" fill="${WHITE}" />
  
  <!-- Bubble tail — bottom-left -->
  <polygon points="${BUBBLE_X + 100},${BUBBLE_Y + BUBBLE_HEIGHT} ${BUBBLE_X + 220},${BUBBLE_Y + BUBBLE_HEIGHT} ${BUBBLE_X + 20},${BUBBLE_Y + BUBBLE_HEIGHT + TAIL_HEIGHT}" fill="${WHITE}" />

  <!-- Shopping bag — centered inside the bubble body -->
  <g transform="translate(${C}, ${BUBBLE_Y + BUBBLE_HEIGHT / 2 - BAG_Y_OFFSET})" fill="none" stroke="${BG}" stroke-width="45" stroke-linecap="round" stroke-linejoin="round">
    <!-- Bag body -->
    <rect x="-170" y="-50" width="340" height="300" rx="30" ry="30" />
    <!-- Bag handles -->
    <path d="M-90,-50 C-90,-180 90,-180 90,-50" />
  </g>
</svg>
`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile('app-icon.png');

console.log('Generated app-icon.png (1200x1200)');
