import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng, podiumPixels } from "../../assets/generate-tray-icon.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const chunks = (png) => {
  const found = {};
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    found[type] = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return found;
};

const alphaAt = (pixels, size, x, y) => pixels[(y * size + x) * 4 + 3];

test("encodePng writes a valid RGBA PNG", () => {
  const pixels = new Uint8Array(3 * 2 * 4).fill(255);
  const png = encodePng({ width: 3, height: 2, pixels });
  assert.deepEqual(png.subarray(0, 8), SIGNATURE);
  const { IHDR, IDAT, IEND } = chunks(png);
  assert.equal(IHDR.readUInt32BE(0), 3);
  assert.equal(IHDR.readUInt32BE(4), 2);
  assert.equal(IHDR[8], 8);
  assert.equal(IHDR[9], 6);
  assert.equal(inflateSync(IDAT).length, 2 * (1 + 3 * 4));
  assert.equal(IEND.length, 0);
});

test("podiumPixels draws black bars on transparent background", () => {
  for (const size of [16, 32]) {
    const pixels = podiumPixels(size);
    const unit = size / 16;
    assert.equal(pixels.length, size * size * 4);
    assert.equal(alphaAt(pixels, size, 0, 0), 0);
    assert.equal(alphaAt(pixels, size, size - 1, 0), 0);
    assert.equal(alphaAt(pixels, size, 7 * unit, 10 * unit), 255);
    assert.equal(alphaAt(pixels, size, 2 * unit, 3 * unit), 0);
    assert.equal(pixels[(10 * unit * size + 7 * unit) * 4], 0);
  }
});
