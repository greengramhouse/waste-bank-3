/**
 * สลับว่าหน้าแรกของเว็บ (index.html) คือระบบไหน
 *
 *   node tools/switch-live.mjs status     ดูว่าตอนนี้หน้าแรกคือระบบอะไร
 *   node tools/switch-live.mjs firestore  ตัดไปใช้ระบบใหม่ — app.html ขึ้นเป็นหน้าแรก
 *   node tools/switch-live.mjs sheets     ย้อนกลับไประบบเดิมบน Google Sheets
 *
 * ทำไมต้องสลับไฟล์ ไม่ใช่แค่ทำ redirect
 *   GitHub Pages เสิร์ฟ index.html ที่ root เป็นหน้าแรกเสมอ และเป็น static ล้วน
 *   ไม่มีที่ให้ตั้ง rewrite rule การสลับชื่อไฟล์จึงเป็นวิธีเดียวที่ตรงไปตรงมา
 *
 * ระบบเดิมไม่เคยถูกลบ แค่เปลี่ยนชื่อไปมา ย้อนกลับได้ทันทีถ้าระบบใหม่มีปัญหา:
 *   index.html          หน้าแรกที่ไลฟ์อยู่ (สำเนาของระบบใดระบบหนึ่ง)
 *   app.html            ระบบใหม่บน Firestore — ต้นฉบับที่แก้โค้ดกันจริง
 *   index-sheets.html   ระบบเดิมบน Google Sheets ที่ถูกพักไว้
 *
 * หลังรันต้อง git commit + push เอง สคริปต์นี้ไม่แตะ git ให้
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const APP = join(ROOT, 'app.html');
const SHEETS = join(ROOT, 'index-sheets.html');

/** ลายนิ้วมือที่แยกสองระบบออกจากกันได้แน่นอน ไม่ต้องพึ่งชื่อไฟล์ */
const MARK_FIRESTORE = 'firebase-firestore-compat';
const MARK_SHEETS = 'script.google.com';

async function detect(path) {
  if (!existsSync(path)) return 'ไม่มีไฟล์';
  const text = await readFile(path, 'utf8');
  if (text.includes(MARK_FIRESTORE)) return 'firestore';
  if (text.includes(MARK_SHEETS)) return 'sheets';
  return 'ไม่รู้จัก';
}

async function status() {
  const [i, a, s] = await Promise.all([detect(INDEX), detect(APP), detect(SHEETS)]);
  console.log('\nสถานะไฟล์ตอนนี้');
  console.log(`  index.html         ${i === 'firestore' ? 'ระบบใหม่ (Firestore)' : i === 'sheets' ? 'ระบบเดิม (Google Sheets)' : i}`);
  console.log(`  app.html           ${a}`);
  console.log(`  index-sheets.html  ${s}`);
  console.log(`\nหน้าแรกของเว็บตอนนี้คือ: ${i === 'firestore' ? '★ ระบบใหม่' : i === 'sheets' ? '★ ระบบเดิม' : '? ' + i}\n`);
  return i;
}

const cmd = process.argv[2];

if (!cmd || cmd === 'status') {
  await status();
  console.log('สลับด้วย: node tools/switch-live.mjs firestore | sheets');
  process.exit(0);
}

if (cmd !== 'firestore' && cmd !== 'sheets') {
  console.error(`✗ ไม่รู้จักคำสั่ง "${cmd}" — ใช้ได้: status | firestore | sheets`);
  process.exit(1);
}

const current = await detect(INDEX);

if (current === cmd) {
  console.log(`\nหน้าแรกเป็น "${cmd}" อยู่แล้ว ไม่ต้องทำอะไร\n`);
  process.exit(0);
}

// ------------------------------------------------------------ ตัดไประบบใหม่

if (cmd === 'firestore') {
  if (await detect(APP) !== 'firestore') {
    console.error('✗ app.html ไม่ใช่ระบบ Firestore — หยุดไว้ก่อน ตรวจไฟล์แล้วลองใหม่');
    process.exit(1);
  }
  // เก็บระบบเดิมไว้ก่อนเสมอ ไม่มีจังหวะไหนที่ index.html หายไปโดยไม่มีสำเนา
  if (current === 'sheets') {
    if (existsSync(SHEETS)) {
      console.error('✗ มี index-sheets.html อยู่แล้ว — ลบหรือเปลี่ยนชื่อก่อน กันเขียนทับของเดิม');
      process.exit(1);
    }
    await rename(INDEX, SHEETS);
    console.log('  ✓ พักระบบเดิมไว้ที่ index-sheets.html');
  }
  // คัดลอก ไม่ใช่ย้าย — app.html ต้องอยู่ที่เดิมเพราะเป็นไฟล์ที่แก้โค้ดกันจริง
  await writeFile(INDEX, await readFile(APP, 'utf8'), 'utf8');
  console.log('  ✓ index.html = สำเนาของ app.html (ระบบใหม่)');
  console.log('\nตัดไประบบใหม่แล้ว — git commit + push เพื่อให้มีผลบนเว็บจริง');
  console.log('ย้อนกลับได้ด้วย: node tools/switch-live.mjs sheets\n');
}

// -------------------------------------------------------- ย้อนกลับระบบเดิม

if (cmd === 'sheets') {
  if (!existsSync(SHEETS)) {
    console.error('✗ ไม่พบ index-sheets.html — ไม่มีระบบเดิมให้ย้อนกลับไป');
    process.exit(1);
  }
  await writeFile(INDEX, await readFile(SHEETS, 'utf8'), 'utf8');
  console.log('  ✓ index.html = ระบบเดิมบน Google Sheets');
  console.log('\nย้อนกลับแล้ว — git commit + push เพื่อให้มีผลบนเว็บจริง');
  console.log('หมายเหตุ: ธุรกรรมที่ครูบันทึกในระบบใหม่ยังอยู่ใน Firestore ครบ');
  console.log('แต่จะไม่ปรากฏในระบบเดิม ต้องย้ายข้อมูลกลับเองถ้าจำเป็น\n');
}

await status();
