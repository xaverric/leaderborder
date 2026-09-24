import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GRID = 16;
const BASELINE = 14;
const BARS = [
  { x: 1, width: 4, height: 8 },
  { x: 6, width: 4, height: 12 },
  { x: 11, width: 4, height: 6 },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const header = (width, height) => {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
};

const scanlines = ({ width, height, pixels }) => {
  const stride = width * 4;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(rows, y * (stride + 1) + 1);
  }
  return rows;
};

export const encodePng = (image) =>
  Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header(image.width, image.height)),
    chunk("IDAT", deflateSync(scanlines(image))),
    chunk("IEND", Buffer.alloc(0)),
  ]);

const insideBar = (gx, gy) =>
  BARS.some((bar) => gx >= bar.x && gx < bar.x + bar.width && gy >= BASELINE - bar.height && gy < BASELINE);

export const podiumPixels = (size) => {
  const unit = size / GRID;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (insideBar(Math.floor(x / unit), Math.floor(y / unit))) pixels[(y * size + x) * 4 + 3] = 255;
    }
  }
  return pixels;
};

const writeIcon = (size, name) => {
  const target = fileURLToPath(new URL(name, import.meta.url));
  writeFileSync(target, encodePng({ width: size, height: size, pixels: podiumPixels(size) }));
  return target;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(writeIcon(16, "./trayTemplate.png"));
  console.log(writeIcon(32, "./trayTemplate@2x.png"));
}
