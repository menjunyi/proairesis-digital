import {detectSkills} from './matching.mjs';
import {inflateRawSync} from 'node:zlib';
export const MAX_RESUME=5*1024*1024;
export class ResumeError extends Error {}
export function validateResume(filename,contentType,buffer){
  if(!buffer?.length||buffer.length>MAX_RESUME)throw new ResumeError('Upload a non-empty PDF or DOCX no larger than 5 MB.');
  const pdf=/\.pdf$/i.test(filename),docx=/\.docx$/i.test(filename);
  if(pdf&&contentType==='application/pdf'&&buffer.subarray(0,5).toString()==='%PDF-')return 'pdf';
  if(docx&&contentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'&&buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))){validateDocxArchive(buffer);return 'docx';}
  throw new ResumeError('The file must be a valid PDF or DOCX with its matching file type.');
}
const MAX_EXPANDED_DOCX = 30 * 1024 * 1024;
const CRC_TABLE = Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

function archiveError(message = 'The DOCX archive is malformed.') {
  throw new ResumeError(message);
}

function validateExtraFields(bytes) {
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) archiveError();
    const id = bytes.readUInt16LE(offset), size = bytes.readUInt16LE(offset + 2);
    if (id === 1) archiveError('ZIP64 documents are not supported.');
    offset += 4 + size;
    if (offset > bytes.length) archiveError();
  }
}

function validateDocxArchive(buffer) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) archiveError();
  const entries = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12);
  const directoryStart = buffer.readUInt32LE(end + 16);
  if (!entries || entries > 2000 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)
    || buffer.readUInt16LE(end + 8) !== entries || directoryStart + directorySize !== end) {
    archiveError('The DOCX contains too many entries or an unsupported archive format.');
  }
  let offset = directoryStart, expandedTotal = 0;
  const names = new Set(), spans = [];
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) archiveError();
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16), compressedSize = buffer.readUInt32LE(offset + 20);
    const expectedSize = buffer.readUInt32LE(offset + 24), nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42), entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > end || !nameLength || nameLength > 1024 || buffer.readUInt16LE(offset + 34)
      || [compressedSize, expectedSize, localOffset].includes(0xffffffff)) archiveError();
    if (flags & ~0x080e || ![0, 8].includes(method)) archiveError('Encrypted or unsupported DOCX compression is not allowed.');
    const remaining = MAX_EXPANDED_DOCX - expandedTotal;
    if (expectedSize > remaining) archiveError('The expanded document is too large. Upload a simpler resume.');
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength), name = nameBytes.toString('utf8');
    const pathParts = name.replace(/\/$/, '').split('/');
    if (!Buffer.from(name).equals(nameBytes) || /[\\\u0000-\u001f]/.test(name) || /^[A-Za-z]:/.test(name)
      || pathParts.some(part => !part || part === '.' || part === '..') || names.has(name)) {
      archiveError('The DOCX contains an unsafe or duplicate archive path.');
    }
    names.add(name);
    validateExtraFields(buffer.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
    if (localOffset + 30 > directoryStart || buffer.readUInt32LE(localOffset) !== 0x04034b50
      || buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method) archiveError();
    const localNameLength = buffer.readUInt16LE(localOffset + 26), localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength, payloadEnd = payloadStart + compressedSize;
    if (payloadStart > directoryStart || payloadEnd > directoryStart
      || !buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)) archiveError();
    validateExtraFields(buffer.subarray(localOffset + 30 + localNameLength, payloadStart));
    let spanEnd = payloadEnd;
    if (flags & 8) {
      let descriptor = payloadEnd;
      if (descriptor + 4 <= directoryStart && buffer.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > directoryStart || buffer.readUInt32LE(descriptor) !== expectedCrc
        || buffer.readUInt32LE(descriptor + 4) !== compressedSize || buffer.readUInt32LE(descriptor + 8) !== expectedSize) archiveError();
      spanEnd = descriptor + 12;
    } else if (buffer.readUInt32LE(localOffset + 14) !== expectedCrc
      || buffer.readUInt32LE(localOffset + 18) !== compressedSize || buffer.readUInt32LE(localOffset + 22) !== expectedSize) archiveError();
    spans.push([localOffset, spanEnd]);
    const compressed = buffer.subarray(payloadStart, payloadEnd);
    let expanded;
    try {
      expanded = method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: Math.max(1, remaining)});
    } catch { archiveError('The DOCX contains corrupt or oversized compressed content.'); }
    if (expanded.length > remaining) archiveError('The expanded document is too large. Upload a simpler resume.');
    if (expanded.length !== expectedSize || crc32(expanded) !== expectedCrc) archiveError('The DOCX archive content does not match its declared size or checksum.');
    expandedTotal += expanded.length;
    if (/\.(?:xml|rels)$/i.test(name) && /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(expanded.toString('utf8').replace(/\u0000/g, ''))) {
      archiveError('XML document types and external entities are not allowed in resumes.');
    }
    offset = entryEnd;
  }
  if (offset !== end) archiveError();
  spans.sort((left, right) => left[0] - right[0]);
  if (spans.some((span, index) => index && span[0] < spans[index - 1][1])) archiveError('The DOCX contains overlapping archive entries.');
  if (!names.has('word/document.xml') || !names.has('[Content_Types].xml')) archiveError('The archive is not a valid Word document.');
}
export async function extractResume(filename,contentType,buffer){
  const kind=validateResume(filename,contentType,buffer);let text;
  try{if(kind==='pdf'){const {extractText,getDocumentProxy}=await import('unpdf');const document=await getDocumentProxy(new Uint8Array(buffer),{isEvalSupported:false,maxImageSize:1000000});try{if(document.numPages>30)throw Error('Too many pages');text=(await extractText(document,{mergePages:true})).text;}finally{await document.loadingTask.destroy();}}else{const mammoth=await import('mammoth');text=(await mammoth.extractRawText({buffer})).value;}}catch{throw new ResumeError('This file could not be read. Upload an unlocked, text-based PDF of at most 30 pages or a DOCX.');}
  text=String(text??'').replace(/\u0000/g,'').trim();
  if(text.length<80)throw new ResumeError('There is not enough readable text. Upload a text-based resume; scanned images are not supported.');
  if(Buffer.byteLength(text)>180000)throw new ResumeError('The extracted resume is too long. Upload a shorter document.');
  return {text,skills:detectSkills(text),warnings:['Review extracted details before matching. Work rights and personal circumstances must be supplied by you.']};
}
