#!/usr/bin/env node
/**
 * Generate 1200x1200 app icon for Shopify App Store
 * A chat bubble with a small shopping bag inside — clean, modern, simple.
 */
import sharp from 'sharp';

const SIZE = 1200;

// Colors
const BG_COLOR = '#5046e4'; // Matches the app's default bubble color
const ICON_COLOR = '#ffffff';

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" fill="${BG_COLOR}" />

  <!-- Chat bubble -->
  <g transform="translate(${SIZE / 2}, ${SIZE * 0.42})">
    <!-- Main bubble shape -->
    <rect x="-340" y="-260" width="680" height="460" rx="80" ry="80" fill="${ICON_COLOR}" />
    <!-- Tail -->
    <polygon points="-160,200 -80,200 -200,320" fill="${ICON_COLOR}" />
  </g>

  <!-- Shopping bag icon inside the bubble -->
  <g transform="translate(${SIZE / 2}, ${SIZE * 0.40})" fill="none" stroke="${BG_COLOR}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <!-- Bag body -->
    <path d="M-100,20 L-120,160 C-122,178 -108,194 -90,194 L90,194 C108,194 122,178 120,160 L100,20 Z" />
    <!-- Bag handles -->
    <path d="M-60,20 C-60,-60 60,-60 60,20" />
    <!-- Bag top opening -->
    <line x1="-100" y1="20" x2="100" y2="20" />
  </g>
</svg>
`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile('app-icon.png');

console.log('Generated app-icon.png (1200x1200)');
