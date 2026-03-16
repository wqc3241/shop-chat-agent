#!/usr/bin/env node
/**
 * Generate 1200x1200 app icon for Shopify App Store
 *
 * Design: White circular chat bubble with a filled shopping bag inside,
 * on brand purple background. Bubble tail at bottom-left.
 */
import sharp from 'sharp';

const SIZE = 1200;
const C = SIZE / 2; // 600

const BG = '#5046e4';
const WHITE = '#ffffff';

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}" />

  <!-- Circular chat bubble -->
  <circle cx="${C}" cy="${C - 50}" r="380" fill="${WHITE}" />

  <!-- Bubble tail — bottom-left, triangular -->
  <polygon points="340,820 460,760 260,980" fill="${WHITE}" />

  <!-- Shopping bag — filled, centered in bubble -->
  <g transform="translate(${C}, ${C - 60})">
    <!-- Bag body (filled) -->
    <path d="M-155,10 L-170,220 C-173,245 -153,265 -128,265 L128,265 C153,265 173,245 170,220 L155,10 Z"
          fill="${BG}" stroke="none" />
    <!-- Bag top edge -->
    <rect x="-155" y="-5" width="310" height="30" rx="8" fill="${BG}" />
    <!-- Bag handles -->
    <path d="M-80,-5 C-80,-110 80,-110 80,-5"
          fill="none" stroke="${BG}" stroke-width="36" stroke-linecap="round" />
  </g>
</svg>
`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile('app-icon.png');

console.log('Generated app-icon.png (1200x1200)');
