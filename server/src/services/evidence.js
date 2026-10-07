import { inflateSync } from 'node:zlib';

export const MAX_EVIDENCE_SIZE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXTENSIONS_BY_TYPE = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
  ['image/gif', new Set(['.gif'])]
]);

const CRC_TABLE = Array.from({length:256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 57 || !buffer.subarray(0, 8).equals(signature)) return false;

  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  let hasEnd = false;
  let idatEnded = false;
  const imageData = [];

  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > buffer.length) return false;

    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + chunkLength);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + chunkLength)) !== expectedCrc) return false;

    if (!hasHeader) {
      if (type !== 'IHDR' || chunkLength !== 13) return false;
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      if (!width || !height || data[10] !== 0 || data[11] !== 0 || data[12] > 1) return false;
      hasHeader = true;
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') {
      if (idatEnded || hasEnd) return false;
      hasImageData = true;
      imageData.push(data);
    } else if (hasImageData && type !== 'IEND') {
      idatEnded = true;
    }

    if (type === 'IEND') {
      if (chunkLength !== 0 || chunkEnd !== buffer.length || !hasImageData) return false;
      hasEnd = true;
      break;
    }

    offset = chunkEnd;
  }

  if (!hasHeader || !hasImageData || !hasEnd) return false;
  try {
    inflateSync(Buffer.concat(imageData), {maxOutputLength:MAX_EVIDENCE_SIZE_BYTES});
    return true;
  } catch {
    return false;
  }
}

function isJpeg(buffer) {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || !buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return false;
  let offset = 2;
  let hasFrame = false;

  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return false;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return false;
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;

    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (segmentLength < 8 || !buffer.readUInt16BE(dataStart + 1) || !buffer.readUInt16BE(dataStart + 3)) return false;
      hasFrame = true;
    }

    if (marker === 0xda) return hasFrame && dataEnd < buffer.length - 2;
    offset = dataEnd;
  }

  return false;
}

function isGif(buffer) {
  if (buffer.length < 14 || !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
    || !buffer.readUInt16LE(6) || !buffer.readUInt16LE(8)) return false;

  let offset = 13;
  const screenFlags = buffer[10];
  if (screenFlags & 0x80) offset += 3 * (2 ** ((screenFlags & 0x07) + 1));
  let hasImage = false;

  while (offset < buffer.length) {
    const block = buffer[offset++];
    if (block === 0x3b) return hasImage && offset === buffer.length;
    if (block === 0x21) {
      if (offset >= buffer.length) return false;
      offset += 1;
    } else if (block === 0x2c) {
      if (offset + 9 > buffer.length) return false;
      const imageWidth = buffer.readUInt16LE(offset + 4);
      const imageHeight = buffer.readUInt16LE(offset + 6);
      const imageFlags = buffer[offset + 8];
      if (!imageWidth || !imageHeight) return false;
      offset += 9;
      if (imageFlags & 0x80) offset += 3 * (2 ** ((imageFlags & 0x07) + 1));
      if (offset >= buffer.length || buffer[offset] < 2 || buffer[offset] > 8) return false;
      offset += 1;
      hasImage = true;
    } else {
      return false;
    }

    let hasData = false;
    while (offset < buffer.length) {
      const blockLength = buffer[offset++];
      if (blockLength === 0) break;
      if (offset + blockLength > buffer.length) return false;
      offset += blockLength;
      hasData = true;
    }
    if (offset > buffer.length || !hasData) return false;
  }

  return false;
}

function isWebp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) return false;

  let offset = 12;
  let hasImage = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + chunkLength + (chunkLength & 1);
    if (chunkEnd > buffer.length) return false;

    if (type === 'VP8 ' && chunkLength >= 10) {
      hasImage = buffer[dataStart + 3] === 0x9d && buffer[dataStart + 4] === 0x01 && buffer[dataStart + 5] === 0x2a
        && (buffer.readUInt16LE(dataStart + 6) & 0x3fff) > 0 && (buffer.readUInt16LE(dataStart + 8) & 0x3fff) > 0;
    } else if (type === 'VP8L' && chunkLength >= 5) {
      hasImage = buffer[dataStart] === 0x2f;
    } else if (type === 'VP8X' && chunkLength < 10) {
      return false;
    }
    offset = chunkEnd;
  }
  return hasImage && offset === buffer.length;
}

function detectEvidenceType(buffer) {
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isPng(buffer)) return 'image/png';
  if (isGif(buffer)) return 'image/gif';
  if (isWebp(buffer)) return 'image/webp';
  return null;
}

export function buildEvidenceStoragePath(userId, originalName = 'evidence') {
  if (!userId || typeof userId !== 'string') throw new Error('A valid user ID is required for evidence storage');
  const safeBase = (originalName || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '-');
  const safeFileName = safeBase || 'evidence';
  return `evidence/${userId}/${Date.now()}-${safeFileName}`;
}

export function normalizeEvidenceFile(file) {
  if (!file) throw new Error('No evidence file provided');
  if (!file.buffer || !file.buffer.length) throw new Error('Evidence file is empty');
  if (file.size > MAX_EVIDENCE_SIZE_BYTES || file.buffer.length > MAX_EVIDENCE_SIZE_BYTES) {
    throw new Error(`Evidence file is too large. Maximum supported size is ${MAX_EVIDENCE_SIZE_BYTES} bytes.`);
  }

  const mimeType = file.mimetype || 'application/octet-stream';
  if (!ALLOWED_EVIDENCE_TYPES.has(mimeType)) {
    throw new Error(`Unsupported evidence file type: ${mimeType}. Allowed types: ${Array.from(ALLOWED_EVIDENCE_TYPES).join(', ')}`);
  }

  const originalName = (file.originalname || 'evidence').replace(/\\/g, '/').split('/').pop() || 'evidence';
  const extension = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
  const detectedType = detectEvidenceType(file.buffer);
  if (!detectedType || detectedType !== mimeType || !EXTENSIONS_BY_TYPE.get(mimeType).has(extension)) {
    throw new Error('Invalid evidence file: file content, MIME type, and extension must match a supported image type');
  }

  return {
    originalName,
    contentType: mimeType,
    size: file.size,
    buffer: file.buffer
  };
}

export function canAccessComplaintEvidence(user, complaint) {
  return Boolean(user?.uid && complaint?.citizenId && (user.uid === complaint.citizenId || user.admin === true));
}
