import { crc32, deflateSync } from "node:zlib";

// #23's exit criterion wants the owned Brief complete on every mandated field,
// media included — a null coverImageKey leaves the one seeded Brief unable to
// demo the upload #21 built. Generating the bytes here rather than committing a
// binary keeps the fixture readable and the repo free of an opaque blob; PNG is
// simple enough to emit directly, and zlib is already in the stdlib.
const WIDTH = 320;
const HEIGHT = 180;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

// A diagonal slate-to-indigo gradient: enough to read as a deliberate cover in
// the UI rather than the broken-image box a 1x1 placeholder would give.
function gradientScanlines(): Buffer {
  // Each PNG scanline is prefixed with its filter type; 0 = None, which costs a
  // few bytes of deflate ratio and saves implementing the filters.
  const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
  let offset = 0;
  for (let y = 0; y < HEIGHT; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < WIDTH; x++) {
      const t = (x / WIDTH + y / HEIGHT) / 2;
      raw[offset++] = Math.round(24 + t * 60);
      raw[offset++] = Math.round(28 + t * 40);
      raw[offset++] = Math.round(48 + t * 130);
    }
  }
  return raw;
}

export function seedCoverImagePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  // bytes 10-12 stay 0: deflate compression, adaptive filtering, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(gradientScanlines())),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
