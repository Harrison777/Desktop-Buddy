/**
 * Convert wizard_hat_icon.png → wizard_hat_icon.ico
 * Uses sharp to resize PNG to standard icon sizes, then wraps them in a proper ICO container.
 * ICO contains: 256, 128, 64, 48, 32, 16 px versions.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const srcPng = path.join(__dirname, '..', 'assets', 'wizard_hat_icon.png');
const outIco = path.join(__dirname, '..', 'assets', 'wizard_hat_icon.ico');

const SIZES = [256, 128, 64, 48, 32, 16];

async function buildIco() {
  const pngBuffers = [];

  for (const size of SIZES) {
    const buf = await sharp(srcPng)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers.push({ size, data: buf });
  }

  // Build ICO file
  // Header: 6 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = pngBuffers.length;
  const dataOffset = headerSize + dirEntrySize * numImages;

  // ICO Header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);            // Reserved
  header.writeUInt16LE(1, 2);            // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4);    // Number of images

  // Directory entries + image data
  const dirEntries = [];
  let currentOffset = dataOffset;

  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // Width  (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);   // Height (0 = 256)
    entry.writeUInt8(0, 2);                          // Color palette
    entry.writeUInt8(0, 3);                          // Reserved
    entry.writeUInt16LE(1, 4);                       // Color planes
    entry.writeUInt16LE(32, 6);                      // Bits per pixel
    entry.writeUInt32LE(data.length, 8);             // Image data size
    entry.writeUInt32LE(currentOffset, 12);          // Offset to image data
    dirEntries.push(entry);
    currentOffset += data.length;
  }

  const ico = Buffer.concat([
    header,
    ...dirEntries,
    ...pngBuffers.map(p => p.data)
  ]);

  fs.writeFileSync(outIco, ico);
  console.log(`✅ Created ICO: ${outIco}`);
  console.log(`   Sizes: ${SIZES.join(', ')} px`);
  console.log(`   File size: ${(ico.length / 1024).toFixed(1)} KB`);
}

buildIco().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
