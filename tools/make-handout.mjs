/**
 * สร้างใบแจ้งบัญชี/รหัสผ่านรายคนไว้พิมพ์แจกครู จาก accounts.json
 *
 *   node tools/make-handout.mjs
 *   node tools/make-handout.mjs --url https://ตัวอย่าง.github.io/waste-bank/
 *
 * ได้ไฟล์ docs/handout-passwords.html → เปิดในเบราว์เซอร์แล้ว Ctrl+P พิมพ์
 * หน้ากระดาษ A4 วางบัตร 2 คอลัมน์ × 4 แถว = 8 ใบต่อแผ่น มีเส้นประให้ตัด
 *
 * ไฟล์ผลลัพธ์มีรหัสผ่านจริง จึงอยู่ใน .gitignore — พิมพ์เสร็จแล้วลบทิ้งได้
 * ต้นฉบับรหัสอยู่ที่ accounts.json เสมอ สร้างใบใหม่ได้ตลอด
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'docs', 'handout-passwords.html');

/** ที่อยู่เว็บที่จะพิมพ์ลงบัตร — เปลี่ยนได้ด้วย --url ตอนรู้โดเมนจริงแล้ว */
const URL_ARG = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
/**
 * ระหว่างช่วงคู่ขนาน หน้าแรกของเว็บยังเป็นระบบเดิมบน Google Sheets ที่หน้าตาเหมือนกันทุกอย่าง
 * บัตรจึงต้องพิมพ์ที่อยู่ที่ลงท้ายด้วย /app.html ไม่งั้นครูจะกรอกรหัสใหม่ในระบบเดิมแล้วเข้าไม่ได้
 * ตอนตัดระบบเสร็จแล้ว (npm run live:new) ค่อยเปลี่ยนกลับเป็น root
 */
const SITE_URL = URL_ARG || 'https://greengramhouse.github.io/waste-bank-3/app.html';

const accountsFile = JSON.parse(await readFile(join(HERE, 'accounts.json'), 'utf8'));
const accounts = accountsFile.accounts || [];

const missing = accounts.filter(a => !a.password);
if (missing.length) {
  console.error(`✗ ยังไม่มีรหัสผ่านใน accounts.json ${missing.length} บัญชี: ${missing.map(a => a.username).join(', ')}`);
  console.error('  รัน `node tools/set-passwords.mjs --apply` ก่อน');
  process.exit(1);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** ครูเห็นเฉพาะห้องตัวเอง แอดมินเห็นทุกห้อง — เขียนให้ชัดบนบัตรเลยจะได้ไม่ต้องอธิบายซ้ำ */
function scopeText(a) {
  if (a.role === 'admin') return 'ผู้ดูแลระบบ · ทำได้ทุกห้อง';
  const rooms = (a.rooms || []).join(', ');
  return `ครูประจำชั้น ${rooms || '—'} · บันทึกได้เฉพาะห้องนี้`;
}

const cards = accounts.map(a => `
    <div class="card">
      <div class="head">
        <span class="logo">♻</span>
        <span class="brand">EcoPink ธนาคารขยะรักษ์โลก</span>
      </div>
      <div class="name">${esc(a.name)}</div>
      <div class="scope">${esc(scopeText(a))}</div>
      <table class="cred">
        <tr><th>เว็บไซต์</th><td class="url">${esc(SITE_URL)}</td></tr>
        <tr><th>ชื่อผู้ใช้</th><td class="mono big">${esc(a.username)}</td></tr>
        <tr><th>รหัสผ่าน</th><td class="mono big">${esc(a.password)}</td></tr>
      </table>
      <div class="note">
        พิมพ์ตัวเล็กทั้งหมด · รหัสมีขีดกลาง<br>
        เก็บใบนี้ไว้ อย่าให้นักเรียนเห็น
      </div>
    </div>`).join('');

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>ใบแจ้งบัญชีผู้ใช้ EcoPink</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&family=Roboto+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Sarabun', sans-serif;
    margin: 0; padding: 8mm 6mm; background: #f4f4f4; color: #1f2937;
  }
  .sheet-note {
    max-width: 190mm; margin: 0 auto 6mm; padding: 4mm 5mm;
    background: #fff7ed; border: 1px solid #fdba74; border-radius: 6px;
    font-size: 12px; line-height: 1.7;
  }
  .sheet-note b { color: #9a3412; }
  .grid {
    max-width: 190mm; margin: 0 auto;
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 0;
  }
  .card {
    border: 1px dashed #9ca3af; background: #fff;
    padding: 5mm; min-height: 62mm;
    display: flex; flex-direction: column;
  }
  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 3mm; }
  .logo {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    background: #ec4899; color: #fff; font-size: 12px;
  }
  .brand { font-size: 11px; font-weight: 700; color: #be185d; letter-spacing: .2px; }
  .name { font-size: 15px; font-weight: 700; line-height: 1.4; }
  .scope { font-size: 11px; color: #6b7280; margin-bottom: 3mm; }
  .cred { width: 100%; border-collapse: collapse; }
  .cred th {
    text-align: left; font-weight: 400; font-size: 11px; color: #6b7280;
    width: 22mm; padding: 1.2mm 0; vertical-align: middle; white-space: nowrap;
  }
  .cred td { padding: 1.2mm 0; }
  .mono { font-family: 'Roboto Mono', monospace; }
  .big {
    font-size: 15px; font-weight: 700; letter-spacing: .5px;
    background: #fdf2f8; padding: 1mm 2mm; border-radius: 3px; display: inline-block;
  }
  .url { font-size: 10px; color: #374151; word-break: break-all; }
  .note {
    margin-top: auto; padding-top: 3mm;
    font-size: 10px; color: #6b7280; line-height: 1.6;
    border-top: 1px solid #f3f4f6;
  }
  @page { size: A4; margin: 8mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet-note { display: none; }
    .card { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="sheet-note">
    <b>วิธีใช้:</b> กด Ctrl+P (⌘+P) แล้วสั่งพิมพ์ — A4 ได้ 8 ใบต่อแผ่น ตัดตามเส้นประแล้วแจกครูรายคน<br>
    <b>ข้อควรระวัง:</b> ไฟล์นี้มีรหัสผ่านจริงทั้งโรงเรียน พิมพ์เสร็จแล้วลบทิ้งได้
    ต้นฉบับอยู่ที่ <code>tools/accounts.json</code> สร้างใหม่ได้ตลอดด้วย <code>npm run handout</code><br>
    <b>ที่อยู่เว็บบนบัตรตอนนี้คือ</b> <code>${esc(SITE_URL)}</code>
    — ถ้ายังไม่ใช่ของจริง รันใหม่ด้วย <code>npm run handout -- --url https://ที่อยู่จริง/</code>
  </div>
  <div class="grid">${cards}
  </div>
</body>
</html>
`;

await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(OUT, html, 'utf8');

console.log(`✓ สร้าง ${OUT}`);
console.log(`  ${accounts.length} ใบ · ที่อยู่เว็บบนบัตร: ${SITE_URL}`);
if (!URL_ARG) {
  console.log('  (ที่อยู่เริ่มต้นของ GitHub Pages — เปลี่ยนได้ด้วย --url)');
}
console.log('  เปิดไฟล์ในเบราว์เซอร์แล้ว Ctrl+P เพื่อพิมพ์');
