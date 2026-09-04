/**
 * สุ่มและตั้งรหัสผ่านรายคนให้บัญชีใน accounts.json แล้วอัปเดตเข้า Firebase Auth
 *
 *   node tools/set-passwords.mjs                  ดูเฉย ๆ ว่าจะได้รหัสอะไรบ้าง (ไม่เขียนอะไรเลย)
 *   node tools/set-passwords.mjs --apply          สุ่มให้คนที่ยังไม่มีรหัสในไฟล์ แล้วเขียนจริง
 *   node tools/set-passwords.mjs --apply --all    สุ่มใหม่ทุกคน แม้คนที่มีรหัสอยู่แล้ว
 *   node tools/set-passwords.mjs --apply --only Sn,Ys    เจาะจงบางบัญชี
 *
 * ทำไมต้องมีสคริปต์นี้แยกจาก seed-firestore.mjs
 *   seedUsers() จงใจไม่รีเซ็ตรหัสของบัญชีที่มีอยู่แล้ว เพื่อไม่ให้การรัน seed ซ้ำ
 *   ไปล้างรหัสที่ครูเปลี่ยนเองไว้ การตั้งรหัสใหม่จึงต้องเป็นการกระทำที่ตั้งใจ
 *   ไม่ใช่ผลข้างเคียงของสคริปต์อื่น
 *
 * ตัวตนที่ใช้เขียน: tools/service-account.json (เหมือนสคริปต์อื่นใน tools/)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { PROJECT_ID, usernameToEmail } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SA_PATH = join(HERE, 'service-account.json');
const ACCOUNTS_PATH = join(HERE, 'accounts.json');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

/** --only Sn,Ys → เซตของ username ที่จะแตะ (ว่าง = ทุกคนตามกติกาปกติ) */
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  if (i === -1 || !process.argv[i + 1]) return null;
  return new Set(process.argv[i + 1].split(',').map(s => s.trim()).filter(Boolean));
})();

// ---------------------------------------------------------------- สุ่มรหัส

/**
 * ชุดอักขระที่ครูอ่านจากกระดาษแล้วพิมพ์ไม่ผิด
 * ตัด 0 O o 1 l I ออกทั้งหมด เพราะบนกระดาษแยกไม่ออก
 * ใช้ตัวพิมพ์เล็กล้วน จะได้ไม่ต้องกด Shift และไม่ต้องเดาว่าตัวไหนใหญ่ตัวไหนเล็ก
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/**
 * รูปแบบ 'eco-xxxxx' — 9 ตัวอักษร พิมพ์บนมือถือได้ไม่ยาก
 * คำนำหน้าคงที่ช่วยให้ครูรู้ว่านี่คือรหัสของระบบธนาคารขยะ ไม่ใช่รหัสอย่างอื่น
 * ความเป็นไปได้ 31^5 ≈ 28 ล้าน เดาสุ่มไม่ไหวเมื่อรวมกับ rate limit ของ Firebase
 */
function generatePassword() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `eco-${s}`;
}

// ------------------------------------------------- เขียนกลับ accounts.json

/**
 * เติม/แทนค่า "password" ในบรรทัดของ username ที่ระบุ โดยแก้ข้อความดิบ
 *
 * ไม่ใช้ JSON.stringify เขียนทับทั้งไฟล์ เพราะไฟล์นี้จัดคอลัมน์ให้คนอ่านไว้
 * และมี _readme อธิบายแต่ละฟิลด์ การ stringify จะพังทั้งสองอย่าง
 */
function upsertPassword(text, username, password) {
  const lines = text.split('\n');
  const needle = `"username": "${username}"`;
  let hit = false;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    hit = true;
    const line = lines[i];

    if (/"password"\s*:\s*"[^"]*"/.test(line)) {
      lines[i] = line.replace(/"password"\s*:\s*"[^"]*"/, `"password": "${password}"`);
    } else {
      // แทรกก่อนปีกกาปิดท้ายบรรทัด — ท้ายบรรทัดเป็น '}' หรือ '},'
      lines[i] = line.replace(/\s*\}(\s*,?)\s*$/, `, "password": "${password}" }$1`);
    }
    break;
  }

  if (!hit) throw new Error(`หาบรรทัดของ ${username} ใน accounts.json ไม่เจอ`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- เริ่มระบบ

const raw = await readFile(ACCOUNTS_PATH, 'utf8');
const accountsFile = JSON.parse(raw);
const accounts = accountsFile.accounts || [];

/** เลือกว่าจะแตะบัญชีไหนบ้าง */
const targets = accounts.filter(a => {
  if (ONLY) return ONLY.has(a.username);
  return ALL || !a.password;
});

if (targets.length === 0) {
  console.log('ไม่มีบัญชีที่ต้องตั้งรหัส — ทุกคนมี password ในไฟล์แล้ว');
  console.log('ถ้าต้องการสุ่มใหม่ทั้งหมด ใส่ --all');
  process.exit(0);
}

// สุ่มรหัสให้ครบก่อน จะได้เห็นตารางเต็มตั้งแต่โหมดดูเฉย ๆ
const plan = targets.map(a => ({ acc: a, password: generatePassword() }));

console.log(`\nโปรเจกต์: ${PROJECT_ID}`);
console.log(`โหมด: ${APPLY ? 'เขียนจริง' : 'ดูเฉย ๆ (ใส่ --apply เพื่อเขียนจริง)'}`);
console.log(`บัญชีที่จะตั้งรหัสใหม่: ${plan.length} จาก ${accounts.length}\n`);

const W = Math.max(...plan.map(p => p.acc.username.length), 8);
console.log(`  ${'username'.padEnd(W)}  ${'รหัสใหม่'.padEnd(10)}  ชื่อ`);
console.log(`  ${'-'.repeat(W)}  ${'-'.repeat(10)}  ${'-'.repeat(28)}`);
for (const p of plan) {
  console.log(`  ${p.acc.username.padEnd(W)}  ${p.password.padEnd(10)}  ${p.acc.name}`);
}

if (!APPLY) {
  console.log('\nยังไม่ได้เขียนอะไร รันซ้ำด้วย --apply เพื่อตั้งรหัสจริง');
  console.log('(รหัสจะถูกสุ่มใหม่อีกครั้งตอนรันจริง ชุดข้างบนเป็นแค่ตัวอย่าง)');
  process.exit(0);
}

// ตัวตนสำหรับเขียน — ต่อ Firebase หลังจากผ่านโหมดดูเฉย ๆ แล้วเท่านั้น
if (existsSync(SA_PATH)) {
  const sa = JSON.parse(await readFile(SA_PATH, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
} else {
  console.error('\n✗ ไม่พบตัวตนสำหรับเขียนข้อมูล — วางไฟล์ที่ tools/service-account.json');
  process.exit(1);
}

const auth = getAuth();

// ---------------------------------------------------------------- ลงมือ

let text = raw;
let ok = 0;
const failed = [];

console.log('');
for (const { acc, password } of plan) {
  const email = usernameToEmail(acc.username);
  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password });
    // เขียนลงไฟล์ทีละคนหลังอัปเดตสำเร็จ ไฟล์จะได้ตรงกับของจริงเสมอแม้สคริปต์พังกลางทาง
    text = upsertPassword(text, acc.username, password);
    await writeFile(ACCOUNTS_PATH, text, 'utf8');
    ok++;
    console.log(`  ✓ ${acc.username.padEnd(W)}  ${password}`);
  } catch (e) {
    failed.push({ username: acc.username, message: e.message });
    console.log(`  ✗ ${acc.username.padEnd(W)}  ${e.code || e.message}`);
  }
}

console.log(`\nตั้งรหัสสำเร็จ ${ok} บัญชี${failed.length ? ` · ล้มเหลว ${failed.length}` : ''}`);
if (failed.length) {
  for (const f of failed) console.log(`  ${f.username}: ${f.message}`);
}

console.log('\nขั้นต่อไป');
console.log('  1. node tools/make-handout.mjs   สร้างใบแจ้งรหัสรายคนไว้พิมพ์แจก');
console.log('  2. accounts.json มีรหัสจริงอยู่แล้ว — ห้าม commit ขึ้น repo สาธารณะ');
