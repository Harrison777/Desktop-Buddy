const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.join(__dirname, '..');
const manifestPath = path.join(projectRoot, 'assets', 'index.json');
const sourcePath = path.join(projectRoot, 'assets', 'wizard_spritesheet.png');
const outputPath = path.join(projectRoot, 'assets', 'wizard_spritesheet_transparent.png');
const previewPath = path.join(projectRoot, 'assets', 'wizard_spritesheet_preview.png');

const CLEANUP_MASKS = {
  0: [{ x: 178, y: 96, w: 20, h: 138 }],
  1: [{ x: 178, y: 96, w: 20, h: 138 }],
  2: [{ x: 180, y: 96, w: 20, h: 138 }],
  3: [{ x: 180, y: 96, w: 20, h: 138 }],
  4: [{ x: 180, y: 102, w: 20, h: 132 }],
  6: [{ x: 229, y: 279, w: 16, h: 26 }]
};

function colorSpread(r, g, b) {
  return Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildClusters(values) {
  if (!values.length) {
    return [192, 244];
  }

  let low = Math.min(...values);
  let high = Math.max(...values);

  for (let i = 0; i < 8; i++) {
    const lowGroup = [];
    const highGroup = [];
    for (const value of values) {
      if (Math.abs(value - low) <= Math.abs(value - high)) lowGroup.push(value);
      else highGroup.push(value);
    }
    low = mean(lowGroup) || low;
    high = mean(highGroup) || high;
  }

  return low < high ? [low, high] : [high, low];
}

function isBackgroundPixel(data, idx, clusters, tolerance, spreadLimit) {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];
  if (a === 0) return false;
  if (colorSpread(r, g, b) > spreadLimit) return false;
  const luma = luminance(r, g, b);
  return clusters.some(cluster => Math.abs(luma - cluster) <= tolerance);
}

function applyCleanupMasks(out, info, startX, startY, frameWidth, frameHeight, frameIndex, clusters) {
  const masks = CLEANUP_MASKS[frameIndex];
  if (!masks?.length) return;

  for (const mask of masks) {
    const maxX = Math.min(frameWidth, mask.x + mask.w);
    const maxY = Math.min(frameHeight, mask.y + mask.h);
    for (let localY = Math.max(0, mask.y); localY < maxY; localY++) {
      for (let localX = Math.max(0, mask.x); localX < maxX; localX++) {
        const idx = ((startY + localY) * info.width + (startX + localX)) * info.channels;
        if (out[idx + 3] === 0) continue;
        if (isBackgroundPixel(out, idx, clusters, 52, 32)) {
          out[idx + 3] = 0;
        }
      }
    }
  }

}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const columns = manifest.layout?.columns || 4;
  const rows = manifest.layout?.rows || 3;

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  const frameWidth = Math.floor(info.width / columns);
  const frameHeight = Math.floor(info.height / rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const frameIndex = row * columns + col;
      const startX = col * frameWidth;
      const startY = row * frameHeight;
      const graySamples = [];

      function pushEdgeSample(x, y) {
        const idx = (y * info.width + x) * info.channels;
        const r = out[idx];
        const g = out[idx + 1];
        const b = out[idx + 2];
        const a = out[idx + 3];
        if (a === 0) return;
        if (colorSpread(r, g, b) > 18) return;
        graySamples.push(luminance(r, g, b));
      }

      for (let x = startX; x < startX + frameWidth; x++) {
        pushEdgeSample(x, startY);
        pushEdgeSample(x, startY + frameHeight - 1);
      }
      for (let y = startY; y < startY + frameHeight; y++) {
        pushEdgeSample(startX, y);
        pushEdgeSample(startX + frameWidth - 1, y);
      }

      const clusters = buildClusters(graySamples);
      const visited = new Uint8Array(frameWidth * frameHeight);
      const queue = [];

      function enqueueLocal(localX, localY) {
        if (localX < 0 || localX >= frameWidth || localY < 0 || localY >= frameHeight) return;
        queue.push(localY * frameWidth + localX);
      }

      for (let x = 0; x < frameWidth; x++) {
        enqueueLocal(x, 0);
        enqueueLocal(x, frameHeight - 1);
      }
      for (let y = 0; y < frameHeight; y++) {
        enqueueLocal(0, y);
        enqueueLocal(frameWidth - 1, y);
      }

      let head = 0;
      while (head < queue.length) {
        const pos = queue[head++];
        if (visited[pos]) continue;
        visited[pos] = 1;

        const localX = pos % frameWidth;
        const localY = Math.floor(pos / frameWidth);
        const x = startX + localX;
        const y = startY + localY;
        const idx = (y * info.width + x) * info.channels;

        if (!isBackgroundPixel(out, idx, clusters, 20, 18)) continue;

        out[idx + 3] = 0;

        enqueueLocal(localX - 1, localY);
        enqueueLocal(localX + 1, localY);
        enqueueLocal(localX, localY - 1);
        enqueueLocal(localX, localY + 1);
      }

      for (let pass = 0; pass < 2; pass++) {
        const toClear = [];
        for (let localY = 1; localY < frameHeight - 1; localY++) {
          for (let localX = 1; localX < frameWidth - 1; localX++) {
            const x = startX + localX;
            const y = startY + localY;
            const idx = (y * info.width + x) * info.channels;
            if (!isBackgroundPixel(out, idx, clusters, 12, 12)) continue;

            let transparentNeighbors = 0;
            const neighborOffsets = [
              [-1, 0], [1, 0], [0, -1], [0, 1]
            ];
            for (const [dx, dy] of neighborOffsets) {
              const nIdx = ((y + dy) * info.width + (x + dx)) * info.channels;
              if (out[nIdx + 3] === 0) transparentNeighbors++;
            }

            if (transparentNeighbors >= 3) toClear.push(idx);
          }
        }
        for (const idx of toClear) out[idx + 3] = 0;
      }

      const componentVisited = new Uint8Array(frameWidth * frameHeight);
      let bestInteriorComponent = null;
      let largestComponent = null;
      let bestSolidComponent = null;

      for (let localY = 0; localY < frameHeight; localY++) {
        for (let localX = 0; localX < frameWidth; localX++) {
          const localPos = localY * frameWidth + localX;
          if (componentVisited[localPos]) continue;
          componentVisited[localPos] = 1;

          const x = startX + localX;
          const y = startY + localY;
          const idx = (y * info.width + x) * info.channels;
          if (out[idx + 3] === 0) continue;

          const queue = [localPos];
          const pixels = [];
          let qHead = 0;
          let touchesEdge = false;
          let solidPixels = 0;

          while (qHead < queue.length) {
            const pos = queue[qHead++];
            const px = pos % frameWidth;
            const py = Math.floor(pos / frameWidth);
            const gx = startX + px;
            const gy = startY + py;
            const gIdx = (gy * info.width + gx) * info.channels;

            if (out[gIdx + 3] === 0) continue;
            pixels.push(gIdx);
            if (!isBackgroundPixel(out, gIdx, clusters, 12, 12)) {
              solidPixels++;
            }
            if (px === 0 || py === 0 || px === frameWidth - 1 || py === frameHeight - 1) {
              touchesEdge = true;
            }

            const neighbors = [
              [px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]
            ];

            for (const [nx, ny] of neighbors) {
              if (nx < 0 || nx >= frameWidth || ny < 0 || ny >= frameHeight) continue;
              const nPos = ny * frameWidth + nx;
              if (componentVisited[nPos]) continue;
              componentVisited[nPos] = 1;
              const nIdx = ((startY + ny) * info.width + (startX + nx)) * info.channels;
              if (out[nIdx + 3] !== 0) queue.push(nPos);
            }
          }

          if (!largestComponent || pixels.length > largestComponent.length) {
            largestComponent = pixels;
          }
          if (
            !bestSolidComponent ||
            solidPixels > bestSolidComponent.solidPixels ||
            (solidPixels === bestSolidComponent.solidPixels && pixels.length > bestSolidComponent.pixels.length)
          ) {
            bestSolidComponent = { pixels, solidPixels };
          }
          if (!touchesEdge && (!bestInteriorComponent || pixels.length > bestInteriorComponent.length)) {
            bestInteriorComponent = pixels;
          }
        }
      }

      const componentToKeep =
        bestSolidComponent && bestSolidComponent.solidPixels > 120
          ? bestSolidComponent.pixels
          : bestInteriorComponent && largestComponent && bestInteriorComponent.length >= largestComponent.length * 0.35
          ? bestInteriorComponent
          : largestComponent;
      if (componentToKeep) {
        const keep = new Set(componentToKeep);
        for (let localY = 0; localY < frameHeight; localY++) {
          for (let localX = 0; localX < frameWidth; localX++) {
            const idx = ((startY + localY) * info.width + (startX + localX)) * info.channels;
            if (out[idx + 3] !== 0 && !keep.has(idx)) {
              out[idx + 3] = 0;
            }
          }
        }
      }

      for (let localY = 0; localY < frameHeight; localY++) {
        for (let localX = 0; localX < frameWidth; localX++) {
          const idx = ((startY + localY) * info.width + (startX + localX)) * info.channels;
          if (out[idx + 3] === 0) continue;
          if (isBackgroundPixel(out, idx, clusters, 8, 8)) {
            out[idx + 3] = 0;
          }
        }
      }

      applyCleanupMasks(out, info, startX, startY, frameWidth, frameHeight, frameIndex, clusters);

      const residueVisited = new Uint8Array(frameWidth * frameHeight);
      for (let localY = 0; localY < frameHeight; localY++) {
        for (let localX = 0; localX < frameWidth; localX++) {
          const localPos = localY * frameWidth + localX;
          if (residueVisited[localPos]) continue;
          residueVisited[localPos] = 1;

          const x = startX + localX;
          const y = startY + localY;
          const idx = (y * info.width + x) * info.channels;
          if (out[idx + 3] === 0) continue;
          if (!isBackgroundPixel(out, idx, clusters, 10, 10)) continue;

          const queue = [localPos];
          const pixels = [];
          let qHead = 0;
          let touchesOpaqueNonBg = false;

          while (qHead < queue.length) {
            const pos = queue[qHead++];
            const px = pos % frameWidth;
            const py = Math.floor(pos / frameWidth);
            const gx = startX + px;
            const gy = startY + py;
            const gIdx = (gy * info.width + gx) * info.channels;

            if (out[gIdx + 3] === 0) continue;
            if (!isBackgroundPixel(out, gIdx, clusters, 10, 10)) continue;
            pixels.push(gIdx);

            const neighbors = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
            for (const [nx, ny] of neighbors) {
              if (nx < 0 || nx >= frameWidth || ny < 0 || ny >= frameHeight) continue;
              const nPos = ny * frameWidth + nx;
              const nIdx = ((startY + ny) * info.width + (startX + nx)) * info.channels;
              if (out[nIdx + 3] !== 0 && !isBackgroundPixel(out, nIdx, clusters, 10, 10)) {
                touchesOpaqueNonBg = true;
              }
              if (residueVisited[nPos]) continue;
              residueVisited[nPos] = 1;
              if (out[nIdx + 3] !== 0) queue.push(nPos);
            }
          }

          if (!touchesOpaqueNonBg && pixels.length <= 140) {
            for (const gIdx of pixels) out[gIdx + 3] = 0;
          }
        }
      }
    }
  }

  await sharp(out, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  }).png().toFile(outputPath);

  await sharp(outputPath)
    .flatten({ background: '#00ff66' })
    .png()
    .toFile(previewPath);

  console.log(`Created transparent sheet: ${outputPath}`);
  console.log(`Created preview sheet: ${previewPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
