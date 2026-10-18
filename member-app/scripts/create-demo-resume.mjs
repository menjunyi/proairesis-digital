import { mkdir, writeFile } from 'node:fs/promises';

// Synthetic acceptance fixture, never seeded into the production job or user store.
const lines = [
  'Alex Example - SYNTHETIC ACCEPTANCE TEST RESUME',
  'Software engineer with four years of relevant experience.',
  'Built TypeScript and React interfaces for internal software tools.',
  'Deployed services on AWS and documented release processes.',
  'Worked with SQL databases, Git and collaborative Agile teams.',
  'Sydney, Australia. This document does not represent a real person.',
];
const stream = 'BT /F1 12 Tf 50 730 Td 20 TL ' + lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n') + ' ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let text = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
const start = Buffer.byteLength(text);
text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
await mkdir('.local', { recursive: true });
await writeFile('.local/synthetic-resume.pdf', text);
console.log('Created .local/synthetic-resume.pdf for local acceptance testing.');
