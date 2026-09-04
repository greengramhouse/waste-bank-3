/**
 * ดึงข้อมูลจาก Google Sheets เดิมมาเก็บเป็น JSON ในเครื่อง
 *
 *   node tools/export-sheets.mjs
 *
 * ใช้ gviz endpoint ซึ่งอ่านชีตสาธารณะได้โดยไม่ต้องยืนยันตัวตน
 * ผลลัพธ์ลงที่ tools/data/*.json (อยู่ใน .gitignore เพราะมีชื่อ-นามสกุลนักเรียนจริง)
 *
 * ไม่ดึงชีต Transactions และ GameState เพราะตกลงกันว่าธุรกรรมเริ่มใหม่หมด
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHEET_ID } from './config.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const SHEETS = ['Data', 'Users', 'WasteTypes'];

/**
 * แยก CSV ตาม RFC 4180 — เขียนเองเพราะข้อมูลมีเครื่องหมายคำพูดครอบและมี "|" ในชื่อครู
 * ใช้ split(',') ตรง ๆ ไม่ได้ ถ้าวันหนึ่งมีชื่อที่มีลูกน้ำจะพังเงียบ
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" คือเครื่องหมายคำพูดตัวจริง
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ข้าม */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows;
}

/** แปลงตาราง 2 มิติเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคอลัมน์ */
function toObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))          // ตัดแถวว่างท้ายชีต
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

async function fetchSheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`
            + `?tqx=out:csv&sheet=${encodeURIComponent(name)}`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`ดึงชีต ${name} ไม่สำเร็จ: HTTP ${res.status}`);

  const text = await res.text();
  if (text.startsWith('<')) {
    throw new Error(`ชีต ${name} ตอบกลับมาเป็น HTML — ชีตอาจไม่ได้เปิดสาธารณะ หรือไม่มีชีตชื่อนี้`);
  }
  return toObjects(parseCsv(text));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const name of SHEETS) {
    const rows = await fetchSheet(name);
    const path = join(OUT_DIR, `${name}.json`);
    await writeFile(path, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`✓ ${name.padEnd(11)} ${String(rows.length).padStart(4)} แถว → tools/data/${name}.json`);
  }

  console.log('\nเสร็จแล้ว ตรวจไฟล์ใน tools/data/ ก่อนรัน seed-firestore.mjs');
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
