// Genera los íconos PNG (192 y 512) a partir de la misma figura que icons/icon.svg.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BOLT = [[286, 64], [150, 292], [246, 292], [218, 448], [366, 204], [266, 204]];
const inside = (x, y) => {
  let c = false;
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i], [xj, yj] = BOLT[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

for (const size of [192, 512]) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4 muestras por píxel para suavizar bordes
      let hits = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        if (inside(((x + dx) * 512) / size, ((y + dy) * 512) / size)) hits++;
      }
      const a = hits / 4, o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(0x14 + (0xb4 - 0x14) * a);
      raw[o + 1] = Math.round(0x12 + (0x8c - 0x12) * a);
      raw[o + 2] = Math.round(0x1c + (0xff - 0x1c) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  writeFileSync(new URL(`../app/icons/icon-${size}.png`, import.meta.url), png);
}
console.log("ok");
