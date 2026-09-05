import { PNG } from "pngjs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { flattenPng, validatePng } from "../src/png.js";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
  );
  return Buffer.concat([header, data, checksum]);
}

function image(data: number[], width = 1, height = 1): Buffer {
  return PNG.sync.write({ width, height, data: Buffer.from(data) });
}

function chunks(bytes: Buffer): string[] {
  const types: string[] = [];
  let offset = signature.length;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    types.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += length + 12;
  }
  return types;
}

describe("PNG boundary", () => {
  it("decodes a valid PNG and strips ancillary metadata", () => {
    const source = image([10, 20, 30, 255]);
    const metadata = chunk("tEXt", Buffer.from("private\u0000value"));
    const withMetadata = Buffer.concat([
      source.subarray(0, source.length - 12),
      metadata,
      source.subarray(-12),
    ]);

    const sanitized = validatePng(withMetadata);

    expect(PNG.sync.read(sanitized, { checkCRC: true }).data).toEqual(
      Buffer.from([10, 20, 30, 255]),
    );
    expect(chunks(sanitized)).not.toContain("tEXt");
  });

  it("does not carry gamma metadata into the sanitized PNG", () => {
    const source = image([10, 20, 30, 255]);
    const withGamma = Buffer.concat([
      source.subarray(0, source.length - 12),
      chunk("gAMA", Buffer.from([0, 0, 177, 143])),
      source.subarray(-12),
    ]);

    expect(chunks(validatePng(withGamma))).not.toContain("gAMA");
  });

  it.each([
    Buffer.from("not a png"),
    Buffer.concat([
      signature,
      chunk("IHDR", Buffer.alloc(12)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    Buffer.concat([
      signature,
      chunk("IHDR", Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    Buffer.concat([
      signature,
      chunk("IHDR", Buffer.from([0, 0, 4, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  ])("rejects malformed or out-of-range PNG headers", (source) => {
    expect(() => validatePng(source)).toThrow("Invalid PNG.");
  });

  it("rejects corrupt chunks, animated PNGs, and oversized inputs", () => {
    const source = image([10, 20, 30, 255]);
    const corrupt = Buffer.from(source);
    corrupt[corrupt.length - 5] ^= 1;
    const animated = Buffer.concat([
      source.subarray(0, 33),
      chunk("acTL", Buffer.alloc(8)),
      source.subarray(33),
    ]);

    expect(() => validatePng(corrupt)).toThrow("Invalid PNG.");
    expect(() => validatePng(animated)).toThrow("Invalid PNG.");
    expect(() => validatePng(Buffer.alloc(1024 * 1024 + 1))).toThrow(
      "Invalid PNG.",
    );
  });

  it("rejects a CRC-valid interlaced PNG before it can inflate a large IDAT", () => {
    const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 1]);
    const compressed = deflateSync(Buffer.alloc(8 * 1024 * 1024));
    const source = Buffer.concat([
      signature,
      chunk("IHDR", header),
      chunk("IDAT", compressed),
      chunk("IEND", Buffer.alloc(0)),
    ]);

    expect(source.length).toBeLessThan(1024 * 1024);
    expect(() => validatePng(source)).toThrow("Invalid PNG.");
  });

  it("flattens transparent RGBA pixels over the requested opaque background", () => {
    const flattened = flattenPng(image([255, 0, 0, 128]), "#0000ff");
    const decoded = PNG.sync.read(flattened, { checkCRC: true });

    expect(decoded.alpha).toBe(false);
    expect(decoded.colorType).toBe(2);
    expect(decoded.data).toEqual(Buffer.from([128, 0, 127, 255]));
  });

  it("requires a hexadecimal opaque background", () => {
    expect(() => flattenPng(image([0, 0, 0, 0]), "blue")).toThrow(
      "Invalid PNG.",
    );
    expect(() => flattenPng(image([0, 0, 0, 0]), null as never)).toThrow(
      "Invalid PNG.",
    );
  });
});
