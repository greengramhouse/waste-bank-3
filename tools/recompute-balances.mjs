/**
 * คำนวณเอกสาร balances ใหม่จากธุรกรรมจริงทั้งหมด
 *
 *   node tools/recompute-balances.mjs --check    ตรวจอย่างเดียว ไม่แก้ไข
 *   node tools/recompute-balances.mjs            แก้ให้ตรง
 *
 * ใช้เมื่อไหร่:
 *   - สงสัยว่ายอดคงเหลือไม่ตรงกับประวัติ
 *   - หลังลบธุรกรรมด้วยมือจาก Firebase Console (ซึ่งไม่ได้ถอยยอดให้)
 *   - หลังรัน tools/test-rules.mjs เพื่อให้แน่ใจว่าไม่มีเศษค้าง
 *
 * ยอดใน balances เป็นข้อมูลซ้ำซ้อน (denormalized) ที่มีไว้ให้หน้าเว็บอ่านเร็ว
 * ความจริงอยู่ที่คอลเลกชัน transactions เสมอ ไฟล์นี้จึงยึด transactions เป็นหลัก
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
const CHECK_ONLY = process.argv.includes('--check');

if (existsSync(SA_PATH)) {
  const sa = JSON.parse(await readFile(SA_PATH, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
} else {
  console.error('✗ ไม่พบ tools/service-account.json');
  process.exit(1);
}

const db = getFirestore();

/** ยอดเปล่าของคนที่ยังไม่มีธุรกรรมเลย */
const zero = () => ({
  totalDeposit: 0, totalWithdraw: 0, balance: 0, totalPoints: 0, totalWeight: 0, lastTxAt: null,
});

const [txSnap, balSnap] = await Promise.all([
  db.collection('transactions').get(),
  db.collection('balances').get(),
]);

// รวมยอดจากธุรกรรมจริง
const computed = {};
txSnap.forEach(d => {
  const t = d.data();
  const id = String(t.memberId);
  if (!computed[id]) computed[id] = zero();
  const c = computed[id];
  const amount = Number(t.amount) || 0;

  if (amount > 0) c.totalDeposit += amount; else c.totalWithdraw += -amount;
  c.balance += amount;
  c.totalPoints += Number(t.points) || 0;
  c.totalWeight += Number(t.weight) || 0;

  const at = t.createdAt || null;
  if (at && (!c.lastTxAt || at.toMillis() > c.lastTxAt.toMillis())) c.lastTxAt = at;
});

// ปัดทศนิยมกันเศษจากเลขทศนิยมฐานสอง (0.1 + 0.2 ไม่เท่ากับ 0.3 พอดี)
const round = n => Math.round(n * 100) / 100;

const drift = [];
const updates = [];

balSnap.forEach(d => {
  const cur = d.data();
  const want = computed[d.id] || zero();

  const diffs = ['totalDeposit', 'totalWithdraw', 'balance', 'totalPoints', 'totalWeight']
    .filter(k => round(Number(cur[k]) || 0) !== round(want[k]));

  if (diffs.length) {
    drift.push({
      id: d.id,
      name: cur.memberName,
      detail: diffs.map(k => `${k}: ${round(Number(cur[k]) || 0)} → ${round(want[k])}`).join(', '),
    });
    updates.push({
      ref: d.ref,
      data: {
        totalDeposit: round(want.totalDeposit),
        totalWithdraw: round(want.totalWithdraw),
        balance: round(want.balance),
        totalPoints: round(want.totalPoints),
        totalWeight: round(want.totalWeight),
        lastTxAt: want.lastTxAt,
      },
    });
  }
});

// คนที่มีธุรกรรมแต่ไม่มีเอกสารยอด — ไม่ควรเกิด แต่ถ้าเกิดต้องรู้
const orphan = Object.keys(computed).filter(id => !balSnap.docs.some(d => d.id === id));

console.log(`\n▶ ตรวจยอดจาก ${txSnap.size} ธุรกรรม เทียบกับ ${balSnap.size} เอกสารยอด\n`);

if (orphan.length) {
  console.log(`⚠ มีธุรกรรมของคนที่ไม่มีเอกสารยอด ${orphan.length} คน: ${orphan.join(', ')}`);
  console.log('  รัน `npm run seed` เพื่อสร้างเอกสารยอดที่ขาด\n');
}

if (!drift.length) {
  console.log('✓ ยอดตรงกับธุรกรรมทุกคน ไม่มีอะไรต้องแก้\n');
  process.exit(0);
}

console.log(`พบยอดไม่ตรง ${drift.length} คน:`);
drift.forEach(d => console.log(`  · ${d.id} ${d.name || ''} — ${d.detail}`));

if (CHECK_ONLY) {
  console.log('\n(โหมด --check ไม่ได้แก้อะไร)\n');
  process.exit(1);
}

for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  updates.slice(i, i + 400).forEach(u => batch.update(u.ref, u.data));
  await batch.commit();
}
console.log(`\n✓ แก้ยอดให้ตรงแล้ว ${updates.length} คน\n`);
