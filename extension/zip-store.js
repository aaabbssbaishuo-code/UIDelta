const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const ZIP_VERSION = 20;
const UINT32_LIMIT = 0xffffffff;

let crcTable;

/**
 * Build a ZIP archive using the uncompressed ("store") method.
 * Each entry is { name: string, data: string | Uint8Array | ArrayBuffer | Blob }.
 */
export async function createStoredZip(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("ZIP 至少需要一个文件。");
  }
  if (entries.length > 0xffff) {
    throw new Error("ZIP 文件数量超过当前导出格式上限。");
  }

  const encoder = new TextEncoder();
  const normalized = [];
  let localSize = 0;

  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error("ZIP 文件名无效。");
    }
    const name = entry.name.replace(/^\/+/, "");
    const nameBytes = encoder.encode(name);
    if (nameBytes.byteLength > 0xffff) throw new Error(`ZIP 文件名过长：${name}`);
    const data = await toBytes(entry.data);
    if (data.byteLength > UINT32_LIMIT) throw new Error(`ZIP 文件过大：${name}`);
    const item = { name, nameBytes, data, crc: crc32(data), offset: localSize };
    localSize += 30 + nameBytes.byteLength + data.byteLength;
    if (localSize > UINT32_LIMIT) throw new Error("ZIP 总大小超过 4GB，当前版本暂不支持 ZIP64。");
    normalized.push(item);
  }

  let centralSize = 0;
  for (const item of normalized) centralSize += 46 + item.nameBytes.byteLength;
  const totalSize = localSize + centralSize + 22;
  if (totalSize > UINT32_LIMIT) throw new Error("ZIP 总大小超过 4GB，当前版本暂不支持 ZIP64。");

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  const { time, date } = toDosDateTime(now);
  let cursor = 0;

  for (const item of normalized) {
    view.setUint32(cursor, 0x04034b50, true);
    view.setUint16(cursor + 4, ZIP_VERSION, true);
    view.setUint16(cursor + 6, UTF8_FLAG, true);
    view.setUint16(cursor + 8, STORE_METHOD, true);
    view.setUint16(cursor + 10, time, true);
    view.setUint16(cursor + 12, date, true);
    view.setUint32(cursor + 14, item.crc, true);
    view.setUint32(cursor + 18, item.data.byteLength, true);
    view.setUint32(cursor + 22, item.data.byteLength, true);
    view.setUint16(cursor + 26, item.nameBytes.byteLength, true);
    view.setUint16(cursor + 28, 0, true);
    cursor += 30;
    output.set(item.nameBytes, cursor);
    cursor += item.nameBytes.byteLength;
    output.set(item.data, cursor);
    cursor += item.data.byteLength;
  }

  const centralOffset = cursor;
  for (const item of normalized) {
    view.setUint32(cursor, 0x02014b50, true);
    view.setUint16(cursor + 4, ZIP_VERSION, true);
    view.setUint16(cursor + 6, ZIP_VERSION, true);
    view.setUint16(cursor + 8, UTF8_FLAG, true);
    view.setUint16(cursor + 10, STORE_METHOD, true);
    view.setUint16(cursor + 12, time, true);
    view.setUint16(cursor + 14, date, true);
    view.setUint32(cursor + 16, item.crc, true);
    view.setUint32(cursor + 20, item.data.byteLength, true);
    view.setUint32(cursor + 24, item.data.byteLength, true);
    view.setUint16(cursor + 28, item.nameBytes.byteLength, true);
    view.setUint16(cursor + 30, 0, true);
    view.setUint16(cursor + 32, 0, true);
    view.setUint16(cursor + 34, 0, true);
    view.setUint16(cursor + 36, 0, true);
    view.setUint32(cursor + 38, 0, true);
    view.setUint32(cursor + 42, item.offset, true);
    cursor += 46;
    output.set(item.nameBytes, cursor);
    cursor += item.nameBytes.byteLength;
  }

  view.setUint32(cursor, 0x06054b50, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, normalized.length, true);
  view.setUint16(cursor + 10, normalized.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, centralOffset, true);
  view.setUint16(cursor + 20, 0, true);
  return output;
}

async function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new Error("ZIP 文件内容类型不受支持。");
}

function crc32(bytes) {
  if (!crcTable) crcTable = makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function toDosDateTime(input) {
  const value = input instanceof Date && !Number.isNaN(input.valueOf()) ? input : new Date();
  const year = Math.max(1980, Math.min(2107, value.getFullYear()));
  const date = ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate();
  const time = (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2);
  return { date, time };
}
