/**
 * ล้างธุรกรรมทั้งหมดและรีเซ็ตยอดคงเหลือเป็นศูนย์ — สำหรับล้างข้อมูลทดสอบก่อนเปิดใช้จริง
 *
 *   node tools/reset-transactions.mjs            ดูว่าจะลบอะไรบ้าง (ไม่ลบจริง)
 *   node tools/reset-transactions.mjs --apply    ลบจริง
 *   node tools/reset-transactions.mjs --apply --keep-deleted   ไม่แตะ deletedTransactions
 *
 * ลบอะไรบ้าง
 *   1. เอกสารทั้งหมดใน transactions
 *   2. เอกสารทั้งหมดใน deletedTransactions (เว้นแต่ใส่ --keep-deleted)
 *   3. รีเซ็ตตัวเลขใน balances ทุกคนเป็นศูนย์ — ไม่ลบเอกสาร เพราะ Security Rules
 *      ใช้ฟิลด์ room ในเอกสารนี้ตรวจสิทธิ์ ถ้าเอกสารหายครูจะบันทึกรายการไม่ได้
 *
 * **ไม่แตะ** members · rooms · wasteTypes · users · บัญชี Firebase Auth
 *
 * ⚠️ ลบแล้วเอาคืนไม่ได้ ใช้เฉพาะตอนล้างข้อมูลทดสอบเท่านั้น
 *    ถ้าครูเริ่มบันทึกข้อมูลจริงแล้ว **ห้ามรันเด็ดขาด**
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { PROJECT_ID } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SA_PATH = join(HERE, 'service-account.json');

const APPLY = process.argv.includes('--apply');
const KEEP_DELETED = process.argv.includes('--keep-deleted');

if (existsSync(SA_PATH)) {
  const sa = JSON.parse(await readFile(SA_PATH, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
} else {
  console.error('✗ ไม่พบตัวตนสำหรับเขียนข้อมูล — วางไฟล์ที่ tools/service-account.json');
  process.exit(1);
}

const db = getFirestore();

/** ตัวเลขที่ต้องกลับไปเป็นศูนย์เมื่อไม่มีธุรกรรมเหลืออยู่ */
const ZERO = {
  totalDeposit: 0,
  totalWithdraw: 0,
  balance: 0,
  totalPoints: 0,
  totalWeight: 0,
  lastTxAt: null,
};

const [txSnap, delSnap, balSnap] = await Promise.all([
  db.collection('transactions').get(),
  db.collection('deletedTransactions').get(),
  db.collection('balances').get(),
]);

// ยอดที่ไม่เป็นศูนย์ = ยอดที่ต้องรีเซ็ต
const dirty = balSnap.docs.filter(d => {
  const v = d.data();
  return (v.balance || 0) !== 0 || (v.totalDeposit || 0) !== 0 || (v.totalWithdraw || 0) !== 0
      || (v.totalPoints || 0) !== 0 || (v.totalWeight || 0) !== 0;
});

console.log(`\nโปรเจกต์: ${PROJECT_ID}`);
console.log(`โหมด: ${APPLY ? '⚠ ลบจริง' : 'ดูเฉย ๆ (ใส่ --apply เพื่อลบจริง)'}\n`);

console.log(`transactions        ${txSnap.size} รายการ`);
txSnap.forEach(d => {
  const t = d.data();
  console.log(`  · ${t.date}  ${t.room || '(ไม่มีห้อง)'}  ${t.memberName}  ${t.wasteTypeName || '-'}  ${t.weight ?? '-'} กก.  ฿${t.amount}`);
});

console.log(`\ndeletedTransactions ${delSnap.size} รายการ${KEEP_DELETED ? '  (ไม่แตะ เพราะใส่ --keep-deleted)' : ''}`);
console.log(`balances ที่ยอดไม่เป็นศูนย์  ${dirty.length} จาก ${balSnap.size} คน`);
dirty.forEach(d => {
  const v = d.data();
  console.log(`  · ${d.id} ${v.memberName} — คงเหลือ ฿${v.balance} · ${v.totalWeight} กก. · ${v.totalPoints} แต้ม`);
});

if (!APPLY) {
  console.log('\nยังไม่ได้ลบอะไร รันซ้ำด้วย --apply เพื่อลบจริง\n');
  process.exit(0);
}

/** ลบทีละ 400 เอกสาร — ขีดจำกัดของ batch คือ 500 operation */
async function deleteAll(snap, label) {
  if (snap.empty) return;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`  ✓ ลบ ${label} ${docs.length} รายการ`);
}

console.log('');
await deleteAll(txSnap, 'transactions');
if (!KEEP_DELETED) await deleteAll(delSnap, 'deletedTransactions');

if (dirty.length) {
  for (let i = 0; i < dirty.length; i += 400) {
    const batch = db.batch();
    dirty.slice(i, i + 400).forEach(d => batch.update(d.ref, ZERO));
    await batch.commit();
  }
  console.log(`  ✓ รีเซ็ตยอดคงเหลือ ${dirty.length} คนเป็นศูนย์ (ไม่ได้ลบเอกสาร)`);
}

// ตรวจซ้ำว่าสะอาดจริง
const [tx2, del2, bal2] = await Promise.all([
  db.collection('transactions').count().get(),
  db.collection('deletedTransactions').count().get(),
  db.collection('balances').get(),
]);
const stillDirty = bal2.docs.filter(d => (d.data().balance || 0) !== 0).length;

console.log('\nตรวจซ้ำหลังลบ');
console.log(`  transactions        ${tx2.data().count}`);
console.log(`  deletedTransactions ${del2.data().count}`);
console.log(`  balances            ${bal2.size} เอกสาร · ยอดไม่เป็นศูนย์ ${stillDirty} คน`);
console.log(stillDirty === 0 && tx2.data().count === 0 ? '\n✓ ฐานสะอาดแล้ว\n' : '\n⚠ ยังมีข้อมูลค้าง ตรวจอีกครั้ง\n');
