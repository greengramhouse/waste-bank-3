/**
 * แปะป้ายแจ้งเตือนบนหน้านักเรียน (student.html) ระหว่างช่วงเปลี่ยนผ่าน
 *
 *   node tools/add-student-notice.mjs           ดูว่าจะแทรกอะไรตรงไหน (ไม่แก้ไฟล์)
 *   node tools/add-student-notice.mjs --apply   แทรกจริง (สำรองไฟล์เดิมไว้ก่อน)
 *   node tools/add-student-notice.mjs --remove  เอาป้ายออกเมื่อย้ายหน้านักเรียนเสร็จแล้ว
 *
 * ทำไมต้องมีป้ายนี้
 *   student.html ยังอ่านข้อมูลจาก Google Sheets ผ่าน Apps Script ตัวเดิม
 *   พอครูเริ่มบันทึกรายการใน Firestore นักเรียนจะไม่เห็นรายการใหม่และแต้มจะไม่ขยับ
 *   ถ้าไม่บอกไว้ นักเรียนจะคิดว่าครูยังไม่บันทึกให้ แล้วไปทวงครู
 *
 * ทำไมเป็นสคริปต์ ไม่ใช่แก้ไฟล์ตรง ๆ
 *   CLAUDE.md กำหนดว่า student.html เป็นไฟล์ที่ห้ามแก้ระหว่างช่วงเปลี่ยนผ่าน
 *   การแตะไฟล์นี้จึงต้องเป็นการกระทำที่ตั้งใจสั่งเอง ถอนคืนได้ และมีสำเนาเดิมเก็บไว้
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'student.html');
const BACKUP = join(ROOT, 'student-before-notice.html.bak');

const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');

/** เครื่องหมายคร่อมบล็อก ใช้หาเพื่อถอนออกทีหลังโดยไม่ต้องเดา */
const START = '<!-- ECOPINK-TRANSITION-NOTICE:START -->';
const END = '<!-- ECOPINK-TRANSITION-NOTICE:END -->';

/**
 * ป้ายเขียนด้วย inline style ล้วน ไม่พึ่งคลาส Tailwind ของหน้านี้
 * เพราะถ้าธีมของหน้าเปลี่ยน ป้ายจะได้ไม่เพี้ยนตาม และถอนออกแล้วไม่เหลือร่องรอย
 */
const BANNER = `${START}
  <div style="position:sticky;top:0;z-index:9999;background:#fff7ed;border-bottom:2px solid #fb923c;
              padding:10px 14px;font-family:'Sarabun',sans-serif;font-size:14px;line-height:1.6;color:#7c2d12;
              display:flex;gap:10px;align-items:flex-start;">
    <span style="font-size:18px;flex:none;">⚠️</span>
    <div>
      <b>ระบบกำลังย้ายฐานข้อมูล</b> — ยอดเงินและแต้มในหน้านี้อาจยังไม่ตรงกับที่ครูบันทึกล่าสุด<br>
      ต้องการทราบยอดล่าสุด สอบถามครูประจำชั้นได้เลย
    </div>
  </div>
${END}`;

if (!existsSync(TARGET)) {
  console.error('✗ ไม่พบ student.html');
  process.exit(1);
}

const html = await readFile(TARGET, 'utf8');
const hasNotice = html.includes(START);

// ---------------------------------------------------------------- ถอนป้าย

if (REMOVE) {
  if (!hasNotice) {
    console.log('ไม่มีป้ายอยู่แล้ว ไม่ต้องทำอะไร');
    process.exit(0);
  }
  // กลืนขึ้นบรรทัดใหม่ที่แทรกไว้ด้วย ไฟล์จะได้กลับไปเหมือนเดิมทุกไบต์
  const cleaned = html.replace(new RegExp(`\\n${START}[\\s\\S]*?${END}`), '');
  await writeFile(TARGET, cleaned, 'utf8');
  console.log('✓ ถอนป้ายออกจาก student.html แล้ว');
  process.exit(0);
}

// ---------------------------------------------------------------- แปะป้าย

if (hasNotice) {
  console.log('มีป้ายอยู่แล้วใน student.html — ถอนออกด้วย --remove ก่อนถ้าจะแก้ข้อความ');
  process.exit(0);
}

const bodyMatch = html.match(/<body[^>]*>/);
if (!bodyMatch) {
  console.error('✗ หาแท็ก <body> ใน student.html ไม่เจอ');
  process.exit(1);
}

if (!APPLY) {
  console.log('\nจะแทรกป้ายนี้ต่อจากแท็ก <body> ทันที:\n');
  console.log(BANNER.split('\n').map(l => '  ' + l).join('\n'));
  console.log(`\nไฟล์เป้าหมาย: student.html`);
  console.log(`สำเนาเดิมจะถูกเก็บไว้ที่: student-before-notice.html.bak`);
  console.log('\nยังไม่ได้แก้อะไร — รันซ้ำด้วย --apply เพื่อแทรกจริง\n');
  process.exit(0);
}

await copyFile(TARGET, BACKUP);
const out = html.replace(bodyMatch[0], `${bodyMatch[0]}\n${BANNER}`);
await writeFile(TARGET, out, 'utf8');

console.log('✓ แทรกป้ายลง student.html แล้ว');
console.log(`  สำเนาเดิม: student-before-notice.html.bak`);
console.log('  ถอนออกได้ด้วย: node tools/add-student-notice.mjs --remove');
