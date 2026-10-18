import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractResume, validateResume} from '../server/resume.mjs';

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const resume = 'Alice Example built TypeScript and React applications, deployed AWS services, and documented software delivery with her team. She also used SQL databases and reviewed code.';
const table = Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
const baseEntries = () => [
  {name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
  {name: '_rels/.rels', text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
  {name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${resume}</w:t></w:r></w:p></w:body></w:document>`},
];

function archive(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.text);
    const method = entry.method ?? 8, flags = entry.flags ?? 0;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const size = entry.declaredSize ?? data.length, crc = crc32(data), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(flags & 8 ? 16 : 0);
    if (descriptor.length) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    local.push(header, name, compressed, descriptor);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const validate = file => validateResume('resume.docx', mime, file);

test('valid stored, deflated and streaming-descriptor DOCX still validate and extract', async () => {
  for (const [method, flags] of [[0, 0], [8, 0], [8, 8]]) {
    const file = archive(baseEntries().map(entry => ({...entry, method, flags})));
    assert.equal(validate(file), 'docx');
    const parsed = await extractResume('resume.docx', mime, file);
    assert.equal(parsed.text, resume);
  }
});

test('actual inflated size is bounded even when both ZIP headers understate it', () => {
  const entries = baseEntries();
  entries[2] = {...entries[2], text: 'x'.repeat(31 * 1024 * 1024), declaredSize: 100};
  const file = archive(entries);
  assert.ok(file.length < 100000);
  assert.throws(() => validate(file), /oversized compressed content/);
});

test('actual inflated sizes share one cumulative document budget', () => {
  const entries = [...baseEntries(), {name: 'first.bin', text: 'x'.repeat(16 * 1024 * 1024)},
    {name: 'second.bin', text: 'y'.repeat(16 * 1024 * 1024), declaredSize: 100}];
  assert.throws(() => validate(archive(entries)), /oversized compressed content/);
});

test('understated content and corrupt deflate data fail before document extraction', () => {
  const entries = baseEntries();
  entries[2].declaredSize = 5;
  assert.throws(() => validate(archive(entries)), /declared size or checksum/);
  const corrupt = archive(baseEntries());
  const contentStart = corrupt.indexOf(Buffer.from('word/document.xml')) + 'word/document.xml'.length;
  corrupt.fill(0xff, contentStart, contentStart + 8);
  assert.throws(() => validate(corrupt), /corrupt or oversized/);
});

test('archive bounds, duplicate paths, traversal, encryption and unsupported methods are rejected', () => {
  for (const entry of [
    {name: '../escape', text: 'content'}, {name: '/absolute', text: 'content'},
    {name: 'word\\escape', text: 'content'}, {name: 'word/document.xml', text: 'duplicate'},
    {name: 'encrypted.bin', text: 'content', flags: 1},
    {name: 'unsupported.bin', text: 'content', method: 9},
  ]) assert.throws(() => validate(archive([...baseEntries(), entry])));
  const corrupt = archive(baseEntries());
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE(corrupt.length, central + 42);
  assert.throws(() => validate(corrupt), /malformed/);
});

test('XML document types and entity declarations are rejected in UTF-8 and UTF-16', () => {
  for (const encoding of ['utf8', 'utf16le']) {
    const entries = baseEntries();
    entries[2].text = Buffer.from('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private/data">]><document/>', encoding);
    assert.throws(() => validate(archive(entries)), /external entities/);
  }
});
