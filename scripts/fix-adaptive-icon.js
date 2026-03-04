#!/usr/bin/env node
/**
 * Fix Adaptive Icon - Weißen Hintergrund transparent machen
 *
 * Android Adaptive Icons brauchen ein foregroundImage mit transparentem
 * Hintergrund. Nur der eigentliche Logo-Inhalt soll sichtbar sein.
 * Der Hintergrund wird dann über backgroundColor in app.json gesetzt.
 *
 * Dieses Script liest adaptive-icon.png, macht weiße/fast-weiße Pixel
 * am Rand transparent und speichert das Ergebnis.
 *
 * Verwendung: node scripts/fix-adaptive-icon.js
 */

const path = require('path');
const sharp = require('sharp');

const INPUT  = path.join(__dirname, '../mobile-app/assets/adaptive-icon.png');
const OUTPUT = path.join(__dirname, '../mobile-app/assets/adaptive-icon.png');

// Schwellwert: Pixel gelten als "weißer Hintergrund" wenn alle Kanäle >= THRESHOLD
const THRESHOLD = 245;

async function main() {
  console.log('Lese adaptive-icon.png...');

  const { data, info } = await sharp(INPUT)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  console.log(`Bild: ${width}x${height}, ${channels} Kanäle`);

  // Flood-Fill vom Rand: Finde zusammenhängende weiße Fläche vom Bild-Rand ausgehend.
  // Alle Pixel die mit dem Rand verbunden und hell sind → transparent
  const pixels  = new Uint8Array(data);
  const visited = new Uint8Array(width * height);
  const queue   = [];

  const isWhite = (idx) => {
    const r = pixels[idx * channels + 0];
    const g = pixels[idx * channels + 1];
    const b = pixels[idx * channels + 2];
    return r >= THRESHOLD && g >= THRESHOLD && b >= THRESHOLD;
  };

  // Starte Flood-Fill von allen Randpixeln
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const idx = y * width + x;
      if (!visited[idx] && isWhite(idx)) {
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const idx = y * width + x;
      if (!visited[idx] && isWhite(idx)) {
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  }

  // BFS
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x   = idx % width;
    const y   = Math.floor(idx / width);

    // Nachbarn (4-connected)
    const neighbors = [];
    if (x > 0)          neighbors.push(idx - 1);
    if (x < width  - 1) neighbors.push(idx + 1);
    if (y > 0)          neighbors.push(idx - width);
    if (y < height - 1) neighbors.push(idx + width);

    for (const n of neighbors) {
      if (!visited[n] && isWhite(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  console.log(`Flood-Fill: ${queue.length} Hintergrundpixel gefunden`);

  // Alle Hintergrundpixel transparent machen
  let changed = 0;
  for (let i = 0; i < queue.length; i++) {
    const idx = queue[i];
    pixels[idx * channels + 3] = 0; // Alpha = 0 (transparent)
    changed++;
  }

  console.log(`${changed} Pixel transparent gemacht`);

  // Als PNG speichern (RGBA)
  await sharp(Buffer.from(pixels), {
    raw: { width, height, channels }
  })
    .png({ compressionLevel: 9 })
    .toFile(OUTPUT);

  console.log(`✅ Gespeichert: ${OUTPUT}`);
  console.log('');
  console.log('Nächster Schritt: APK neu bauen (build-apk.bat / build-apk.sh)');
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
