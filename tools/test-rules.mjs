/**
 * ทดสอบ Security Rules และตรรกะธุรกรรมกับฐานข้อมูลจริง
 *
 *   node tools/test-rules.mjs
 *
 * ล็อกอินด้วย client SDK เหมือนหน้าเว็บทุกประการ แล้วยิงคำสั่งที่ "ควรผ่าน"
 * และ "ควรถูกปฏิเสธ" เพื่อพิสูจน์ว่ากฎกันจริง ไม่ใช่แค่ซ่อนปุ่มในหน้าจอ
 *
 * เขียนข้อมูลทดสอบลงฐานจริง แล้วลบทิ้งให้เองตอนจบ
 * ใช้ Admin SDK เก็บกวาดปิดท้ายเผื่อเทสต์ล้มกลางคัน
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where,
  orderBy, writeBatch, serverTimestamp, increment, deleteDoc,
} from 'firebase/firestore';

import { initializeApp as initAdmin, cert } from 'firebase-admin/app';
import { getFirestore as getAdminDb } from 'firebase-admin/firestore';

import { PROJECT_ID, usernameToEmail, todayBangkok, schoolYearOf } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const firebaseConfig = {
  apiKey: 'AIzaSyDfU8poHLuoAkVfk2ShCEm-xBigteeg8s4',
  authDomain: 'ecopink.firebaseapp.com',
  projectId: 'ecopink',
  storageBucket: 'ecopink.firebasestorage.app',
  messagingSenderId: '324094004861',
  appId: '1:324094004861:web:fe6189faabe45f103a6b14',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const accountsFile = JSON.parse(await readFile(join(HERE, 'accounts.json'), 'utf8'));
const PW = accountsFile.defaultPassword;
const TODAY = todayBangkok();
const SY = schoolYearOf(TODAY);

// ผู้เล่นในการทดสอบ
const TEACHER = accountsFile.accounts.find(a => a.username === 'Sn');   // ครู ป.5
const OTHER = accountsFile.accounts.find(a => a.username === 'Sb');     // ครู อ.2
const ADMIN = accountsFile.accounts.find(a => a.username === 'ac');

let pass = 0, fail = 0;
const createdTxIds = [];
let victimId = null, victimName = null, teacherMemberId = null;

function ok(m) { console.log(`  ✓ ${m}`); pass++; }
function bad(m) { console.log(`  ✗ ${m}`); fail++; }

/** คำสั่งนี้ต้องสำเร็จ */
async function shouldAllow(label, fn) {
  try { const r = await fn(); ok(label); return r; }
  catch (e) { bad(`${label} — ถูกปฏิเสธทั้งที่ควรผ่าน (${e.code || e.message})`); return null; }
}

/** คำสั่งนี้ต้องถูกปฏิเสธ ถ้าผ่านแปลว่ากฎรั่ว */
async function shouldDeny(label, fn) {
  try {
    await fn();
    bad(`${label} — ผ่านได้ทั้งที่ต้องถูกปฏิเสธ ❗กฎรั่ว`);
  } catch (e) {
    if (e.code === 'permission-denied' || /permission|insufficient/i.test(e.message || '')) ok(label);
    else bad(`${label} — ถูกปฏิเสธด้วยเหตุผลอื่น (${e.code || e.message})`);
  }
}

async function login(acc) {
  await signInWithEmailAndPassword(auth, usernameToEmail(acc.username), acc.password || PW);
}

function txDoc(member, room, over) {
  return {
    type: 'deposit', schoolYear: SY, date: TODAY, createdAt: serverTimestamp(),
    memberId: member, memberName: 'ทดสอบระบบ', room,
    wasteTypeId: 'W4918', wasteTypeName: 'ขวดพลาสติก',
    weight: 2, amount: 16, points: 6,
    recordedByUid: auth.currentUser.uid, recordedByName: 'ทดสอบ',
    ...over,
  };
}

async function commitTx(payload, memberId) {
  const ref = doc(collection(db, 'transactions'));
  const batch = writeBatch(db);
  batch.set(ref, payload);
  batch.update(doc(db, 'balances', memberId), {
    totalDeposit: increment(payload.amount > 0 ? payload.amount : 0),
    totalWithdraw: increment(payload.amount < 0 ? -payload.amount : 0),
    balance: increment(payload.amount),
    totalWeight: increment(payload.weight || 0),
    totalPoints: increment(payload.points || 0),
    lastTxAt: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

// ============================================================ เริ่มทดสอบ

console.log(`\n▶ ทดสอบกฎกับโปรเจกต์จริง (${PROJECT_ID})  วันที่ ${TODAY}  ปีการศึกษา ${SY}\n`);

// ---------- 1. ยังไม่ล็อกอิน ----------
console.log('1) ยังไม่ได้ล็อกอิน — ต้องอ่านอะไรไม่ได้เลย');
await shouldDeny('อ่าน members ไม่ได้', () => getDocs(query(collection(db, 'members'), where('room', '==', 'ป.5'))));
await shouldDeny('อ่าน wasteTypes ไม่ได้', () => getDocs(collection(db, 'wasteTypes')));

// ---------- 2. ครู ป.5 ----------
console.log(`\n2) ล็อกอินเป็นครู ${TEACHER.username} (${TEACHER.name}) — ห้อง ${TEACHER.rooms[0]}`);
await login(TEACHER);
ok(`ล็อกอินสำเร็จ uid=${auth.currentUser.uid.slice(0, 8)}…`);

const claims = (await auth.currentUser.getIdTokenResult()).claims;
if (claims.role === 'teacher' && Array.isArray(claims.rooms) && claims.rooms[0] === 'ป.5') {
  ok(`custom claims มาถูก role=${claims.role} rooms=${JSON.stringify(claims.rooms)}`);
} else {
  bad(`custom claims ผิด: ${JSON.stringify({ role: claims.role, rooms: claims.rooms })}`);
}

await shouldAllow('อ่านเอกสาร users ของตัวเองได้', () => getDoc(doc(db, 'users', auth.currentUser.uid)));
await shouldAllow('อ่าน wasteTypes ได้', () => getDocs(collection(db, 'wasteTypes')));
await shouldAllow('อ่าน rooms ได้', () => getDocs(collection(db, 'rooms')));

const mine = await shouldAllow('อ่านรายชื่อห้องตัวเอง (ป.5) ได้',
  () => getDocs(query(collection(db, 'members'), where('room', '==', 'ป.5'))));
if (mine) {
  const students = mine.docs.filter(d => d.data().type === 'student');
  const staff = mine.docs.filter(d => d.data().type === 'staff');
  console.log(`      → นักเรียน ${students.length} คน + ครูในห้อง ${staff.length} คน (${staff.map(d => d.data().fullName).join(', ')})`);
  if (staff.length >= 1) ok('เห็นตัวเองในรายชื่อ จึงรับฝากขยะในชื่อตัวเองได้');
  else bad('ไม่เห็นครูในรายชื่อห้องตัวเอง — ฟีเจอร์ครูฝากขยะเองจะหาย');

  const v = students[0];
  victimId = v.id; victimName = v.data().fullName;
  teacherMemberId = staff[0] ? staff[0].id : null;
}

await shouldDeny('อ่านรายชื่อห้องอื่น (ม.3) ไม่ได้',
  () => getDocs(query(collection(db, 'members'), where('room', '==', 'ม.3'))));
await shouldDeny('อ่าน members ทั้งหมดรวดเดียวไม่ได้', () => getDocs(collection(db, 'members')));
await shouldDeny('อ่านเอกสาร users ของคนอื่นไม่ได้',
  () => getDoc(doc(db, 'users', 'ไม่ว่า-uid-ไหนก็ตาม')));

// ---------- 3. บันทึกรับฝาก ----------
console.log('\n3) บันทึกรับฝาก');
const before = (await getDoc(doc(db, 'balances', victimId))).data();

const txId = await shouldAllow(`รับฝากให้ ${victimName} (ป.5) ได้`,
  () => commitTx(txDoc(victimId, 'ป.5'), victimId));
if (txId) createdTxIds.push(txId);

if (teacherMemberId) {
  const selfTx = await shouldAllow('รับฝากในชื่อครูตัวเองได้',
    () => commitTx(txDoc(teacherMemberId, 'ป.5'), teacherMemberId));
  if (selfTx) createdTxIds.push(selfTx);
}

const after = (await getDoc(doc(db, 'balances', victimId))).data();
if (after.balance - before.balance === 16 && after.totalPoints - before.totalPoints === 6
    && after.totalWeight - before.totalWeight === 2) {
  ok(`ยอดสรุปเดินถูก: เงิน +${after.balance - before.balance} แต้ม +${after.totalPoints - before.totalPoints} น้ำหนัก +${after.totalWeight - before.totalWeight}`);
} else {
  bad(`ยอดสรุปเพี้ยน: ${JSON.stringify({ balance: after.balance - before.balance, points: after.totalPoints - before.totalPoints, weight: after.totalWeight - before.totalWeight })}`);
}

// ---------- 4. สิ่งที่ครูต้องทำไม่ได้ ----------
console.log('\n4) สิ่งที่ครูต้องทำไม่ได้');
await shouldDeny('บันทึกรับฝากให้ห้องอื่น (ม.3) ไม่ได้',
  () => commitTx(txDoc('9999', 'ม.3'), victimId));
await shouldDeny('ถอนเงินไม่ได้ (สงวนให้แอดมิน)',
  () => commitTx(txDoc(victimId, 'ป.5', { type: 'withdraw', amount: -50, weight: null, points: null, wasteTypeName: 'ถอนเงินออก' }), victimId));
await shouldDeny('สวมชื่อครูคนอื่นเป็นผู้บันทึกไม่ได้',
  () => commitTx(txDoc(victimId, 'ป.5', { recordedByUid: 'uid-ของคนอื่น' }), victimId));
await shouldDeny('ใส่วันที่รูปแบบผิดไม่ได้',
  () => commitTx(txDoc(victimId, 'ป.5', { date: '4/9/2569' }), victimId));
await shouldDeny('แก้ไขธุรกรรมย้อนหลังไม่ได้',
  () => writeBatch(db).update(doc(db, 'transactions', createdTxIds[0]), { amount: 99999 }).commit());
await shouldDeny('แก้ราคาประเภทขยะไม่ได้ (สงวนให้แอดมิน)',
  () => writeBatch(db).update(doc(db, 'wasteTypes', 'W4918'), { price: 999 }).commit());
await shouldDeny('แก้รายชื่อนักเรียนไม่ได้ (สงวนให้แอดมิน)',
  () => writeBatch(db).update(doc(db, 'members', victimId), { name: 'แก้มั่ว' }).commit());

// ---------- 5. อ่านธุรกรรม ----------
console.log('\n5) อ่านประวัติธุรกรรม');
await shouldAllow('อ่านธุรกรรมห้องตัวเอง เรียงตามวันที่ได้ (ใช้ composite index)',
  () => getDocs(query(collection(db, 'transactions'),
    where('schoolYear', '==', SY), where('room', '==', 'ป.5'),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'))));
await shouldAllow('กรองช่วงวันที่ด้วย string ได้',
  () => getDocs(query(collection(db, 'transactions'),
    where('schoolYear', '==', SY), where('room', '==', 'ป.5'),
    where('date', '>=', TODAY), where('date', '<=', TODAY),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'))));
await shouldDeny('อ่านธุรกรรมทั้งโรงเรียนไม่ได้',
  () => getDocs(query(collection(db, 'transactions'), where('schoolYear', '==', SY),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'))));

// ---------- 6. ลบรายการ ----------
console.log('\n6) ลบรายการ — ต้องย้ายไป deletedTransactions และยอดต้องถอยกลับ');
const delId = createdTxIds.pop();
const delSnap = await getDoc(doc(db, 'transactions', delId));
const delData = delSnap.data();
const beforeDel = (await getDoc(doc(db, 'balances', delData.memberId))).data();

await shouldAllow('ลบรายการของห้องตัวเองได้', async () => {
  const b = writeBatch(db);
  b.delete(doc(db, 'transactions', delId));
  b.set(doc(db, 'deletedTransactions', delId), {
    ...delData, deletedAt: serverTimestamp(),
    deletedByUid: auth.currentUser.uid, deletedByName: TEACHER.name,
  });
  b.update(doc(db, 'balances', delData.memberId), {
    totalDeposit: increment(-(delData.amount > 0 ? delData.amount : 0)),
    totalWithdraw: increment(-(delData.amount < 0 ? -delData.amount : 0)),
    balance: increment(-delData.amount),
    totalWeight: increment(-(delData.weight || 0)),
    totalPoints: increment(-(delData.points || 0)),
    lastTxAt: serverTimestamp(),
  });
  await b.commit();
});

const afterDel = (await getDoc(doc(db, 'balances', delData.memberId))).data();
if (afterDel.balance === beforeDel.balance - delData.amount) ok('ยอดถอยกลับถูกต้องหลังลบ');
else bad(`ยอดไม่ถอยกลับ: ${beforeDel.balance} → ${afterDel.balance}`);

await shouldDeny('ครูอ่านที่เก็บรายการที่ถูกลบไม่ได้ (สงวนให้แอดมินตรวจสอบ)',
  () => getDoc(doc(db, 'deletedTransactions', delId)));

// ---------- 7. ครูห้องอื่น ----------
console.log(`\n7) ล็อกอินเป็นครู ${OTHER.username} (ห้อง ${OTHER.rooms[0]}) — ต้องไม่เห็นของ ป.5`);
await signOut(auth);
await login(OTHER);
await shouldDeny('อ่านรายชื่อ ป.5 ไม่ได้',
  () => getDocs(query(collection(db, 'members'), where('room', '==', 'ป.5'))));
await shouldDeny('อ่านธุรกรรม ป.5 ไม่ได้',
  () => getDocs(query(collection(db, 'transactions'),
    where('schoolYear', '==', SY), where('room', '==', 'ป.5'),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'))));
await shouldDeny('ลบรายการของ ป.5 ไม่ได้', () => deleteDoc(doc(db, 'transactions', createdTxIds[0])));

// ---------- 8. แอดมิน ----------
console.log(`\n8) ล็อกอินเป็นแอดมิน ${ADMIN.username}`);
await signOut(auth);
await login(ADMIN);

await shouldAllow('อ่าน members ทั้งโรงเรียนได้', () => getDocs(collection(db, 'members')));
await shouldAllow('อ่านธุรกรรมทั้งโรงเรียนได้',
  () => getDocs(query(collection(db, 'transactions'), where('schoolYear', '==', SY),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'))));
await shouldAllow('อ่านที่เก็บรายการที่ถูกลบได้', () => getDoc(doc(db, 'deletedTransactions', delId)));

const wId = await shouldAllow('ถอนเงินได้', () => commitTx(
  txDoc(victimId, 'ป.5', { type: 'withdraw', amount: -10, weight: null, points: null, wasteTypeName: 'ถอนเงินออก' }),
  victimId));
if (wId) createdTxIds.push(wId);

const afterW = (await getDoc(doc(db, 'balances', victimId))).data();
if (afterW.totalWithdraw >= 10) ok(`ยอดถอนสะสมเดินถูก (${afterW.totalWithdraw})`);
else bad(`ยอดถอนไม่เดิน: ${afterW.totalWithdraw}`);

await shouldAllow('แก้ราคาประเภทขยะได้',
  () => writeBatch(db).update(doc(db, 'wasteTypes', 'W4918'), { price: 8 }).commit());

await signOut(auth);

// ============================================================ เก็บกวาด

console.log('\n9) ลบข้อมูลทดสอบ');
if (existsSync(join(HERE, 'service-account.json'))) {
  const sa = JSON.parse(await readFile(join(HERE, 'service-account.json'), 'utf8'));
  initAdmin({ credential: cert(sa), projectId: sa.project_id });
  const adb = getAdminDb();

  const b = adb.batch();
  for (const id of createdTxIds) b.delete(adb.collection('transactions').doc(id));
  b.delete(adb.collection('deletedTransactions').doc(delId));
  await b.commit();

  /**
   * คำนวณยอดใหม่จากธุรกรรมที่เหลือจริง — ห้ามล้างเป็นศูนย์ดื้อ ๆ
   * เพราะคนที่เทสต์ไปแตะอาจมีธุรกรรมจริงของตัวเองอยู่ก่อนแล้ว
   * (ตรรกะเดียวกับ tools/recompute-balances.mjs)
   */
  const touched = [...new Set([victimId, teacherMemberId].filter(Boolean))];
  const b2 = adb.batch();
  for (const id of touched) {
    const rest = await adb.collection('transactions').where('memberId', '==', id).get();
    const acc = { totalDeposit: 0, totalWithdraw: 0, balance: 0, totalPoints: 0, totalWeight: 0, lastTxAt: null };
    rest.forEach(d => {
      const t = d.data();
      const amount = Number(t.amount) || 0;
      if (amount > 0) acc.totalDeposit += amount; else acc.totalWithdraw += -amount;
      acc.balance += amount;
      acc.totalPoints += Number(t.points) || 0;
      acc.totalWeight += Number(t.weight) || 0;
      if (t.createdAt && (!acc.lastTxAt || t.createdAt.toMillis() > acc.lastTxAt.toMillis())) acc.lastTxAt = t.createdAt;
    });
    b2.update(adb.collection('balances').doc(id), acc);
  }
  await b2.commit();

  ok(`ลบธุรกรรมทดสอบ ${createdTxIds.length + 1} รายการ และคำนวณยอดของ ${touched.length} คนใหม่จากธุรกรรมที่เหลือ`);
} else {
  bad('ไม่พบ service-account.json — ข้อมูลทดสอบยังค้างอยู่ในฐาน กรุณาลบเอง');
}

// ============================================================ สรุป

console.log('\n─────────────────────────────────────────');
console.log(fail ? `✗ ผ่าน ${pass} / ไม่ผ่าน ${fail}` : `✓ ผ่านทั้งหมด ${pass} ข้อ`);
console.log('─────────────────────────────────────────\n');
process.exit(fail ? 1 : 0);
