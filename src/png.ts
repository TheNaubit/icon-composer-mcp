import { PNG } from "pngjs";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_DIMENSION = 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value >>> 1) ^ (-(value & 1) & 0xedb88320);
  crcTable[index] = value >>> 0;
}

function invalidPng(): never {
  throw new Error("Invalid PNG.");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/** Reject unsafe PNG containers before decoding, then re-encode their pixels. */
function inspectPng(bytes: Buffer): void {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > MAX_INPUT_BYTES ||
    bytes.length < PNG_SIGNATURE.length + 25
  )
    invalidPng();
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    invalidPng();

  let offset = PNG_SIGNATURE.length;
  let seenIdat = false;
  let finishedIdat = false;
  let sawIend = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalidPng();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalidPng();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) invalidPng();
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (
      crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)
    )
      invalidPng();

    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== 13) invalidPng();
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      if (
        width < 1 ||
        width > MAX_DIMENSION ||
        height < 1 ||
        height > MAX_DIMENSION
      )
        invalidPng();
      const bitDepth = bytes[dataStart + 8]!;
      const colorType = bytes[dataStart + 9]!;
      const compression = bytes[dataStart + 10]!;
      const filter = bytes[dataStart + 11]!;
      const interlace = bytes[dataStart + 12]!;
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        (colorType === 4 && [8, 16].includes(bitDepth)) ||
        (colorType === 6 && [8, 16].includes(bitDepth));
      if (
        !validBitDepth ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      )
        invalidPng();
    } else if (type === "IHDR" || type === "acTL") {
      invalidPng();
    }

    if (type === "IDAT") {
      if (finishedIdat) invalidPng();
      seenIdat = true;
    } else if (seenIdat) {
      finishedIdat = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !seenIdat || dataEnd + 4 !== bytes.length)
        invalidPng();
      sawIend = true;
      break;
    }
    if (type[0] === type[0]!.toUpperCase() && !CRITICAL_CHUNKS.has(type))
      invalidPng();
    offset = dataEnd + 4;
  }

  if (!sawIend) invalidPng();
}

function decodePng(bytes: Buffer): PNG {
  try {
    inspectPng(bytes);
    return PNG.sync.read(bytes, { checkCRC: true });
  } catch {
    return invalidPng();
  }
}

/** Validate an untrusted PNG and return a new PNG containing pixels only. */
export function validatePng(bytes: Buffer): Buffer {
  const image = decodePng(bytes);
  try {
    const sanitized = new PNG({ width: image.width, height: image.height });
    sanitized.data = Buffer.from(image.data);
    return PNG.sync.write(sanitized, {
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
    });
  } catch {
    return invalidPng();
  }
}

function parseBackground(background: string): [number, number, number] {
  if (typeof background !== "string") invalidPng();
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(
    background,
  );
  if (!match) invalidPng();
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ];
}

/** Composite PNG alpha onto an opaque background and return an RGB PNG. */
export function flattenPng(bytes: Buffer, background: string): Buffer {
  const [red, green, blue] = parseBackground(background);
  const image = decodePng(bytes);
  const data = Buffer.alloc(image.width * image.height * 4);

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3]!;
    data[offset] = Math.round(
      (image.data[offset]! * alpha + red * (255 - alpha)) / 255,
    );
    data[offset + 1] = Math.round(
      (image.data[offset + 1]! * alpha + green * (255 - alpha)) / 255,
    );
    data[offset + 2] = Math.round(
      (image.data[offset + 2]! * alpha + blue * (255 - alpha)) / 255,
    );
    data[offset + 3] = 255;
  }

  try {
    const flattened = new PNG({ width: image.width, height: image.height });
    flattened.data = data;
    return PNG.sync.write(flattened, {
      colorType: 2,
      inputColorType: 6,
      inputHasAlpha: true,
    });
  } catch {
    return invalidPng();
  }
}
