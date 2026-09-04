/**
 * ตรวจความถูกต้องของข้อมูลหลัง seed
 *
 *   node tools/verify.mjs --emulator
 *   node tools/verify.mjs
 *
 * ตรวจว่าข้อมูลครบและเชื่อมโยงกันถูก ไม่ได้ตรวจ Security Rules
 * (Rules ต้องทดสอบด้วย emulator แยกต่างหาก — ดู README)
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import { PROJECT_ID, ROOM_ORDER, STAFF_ROOM, usernameToEmail } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SA_PATH = join(HERE, 'service-account.json');
const USE_EMULATOR = process.argv.includes('--emulator');

if (USE_EMULATOR) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  initializeApp({ projectId: PROJECT_ID });
} else if (existsSync(SA_PATH)) {
  const sa = JSON.parse(await readFile(SA_PATH, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
} else {
  console.error('✗ ไม่พบตัวตน — วาง tools/service-account.json หรือรันด้วย --emulator');
  process.exit(1);
}

const db = getFirestore();
const auth = getAuth();

let failures = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const bad  = (m) => { console.log(`  ✗ ${m}`); failures++; };

function check(cond, good, badMsg) { cond ? ok(good) : bad(badMsg); }

async function main() {
  console.log(`\n▶ ตรวจ ${USE_EMULATOR ? 'EMULATOR' : PROJECT_ID}\n`);

  const [membersSnap, roomsSnap, usersSnap, typesSnap, balancesSnap, txSnap] =
    await Promise.all([
      db.collection('members').get(),
      db.collection('rooms').get(),
      db.collection('users').get(),
      db.collection('wasteTypes').get(),
      db.collection('balances').select().get(),
      db.collection('transactions').limit(1).get(),
    ]);

  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const students = members.filter(m => m.type === 'student');
  const staff = members.filter(m => m.type === 'staff');

  // ---------- จำนวน ----------
  console.log('จำนวนเอกสาร');
  check(members.length === 303, `members ${members.length} (นักเรียน ${students.length} / บุคลากร ${staff.length})`,
        `members ${members.length} — คาดหวัง 303 (นักเรียน 284 / บุคลากร 19)`);
  check(students.length === 284, `นักเรียน ${students.length} คน`, `นักเรียน ${students.length} คน — คาดหวัง 284`);
  check(staff.length === 19, `บุคลากร ${staff.length} คน`, `บุคลากร ${staff.length} คน — คาดหวัง 19`);
  check(roomsSnap.size === 11, `rooms ${roomsSnap.size} ห้อง`, `rooms ${roomsSnap.size} — คาดหวัง 11`);
  check(typesSnap.size >= 1, `wasteTypes ${typesSnap.size} ประเภท`, 'ไม่มีประเภทขยะเลย');
  check(balancesSnap.size === members.length, `balances ${balancesSnap.size} เอกสาร ครบทุกคน`,
        `balances ${balancesSnap.size} — ไม่ตรงกับ members ${members.length}`);
  console.log(`  · transactions ${txSnap.empty ? 'ว่าง (เริ่มใหม่ตามแผน)' : 'มีข้อมูลแล้ว'}`);

  // ---------- ความสมบูรณ์ของ members ----------
  console.log('\nความถูกต้องของรายชื่อ');
  const badRoom = students.filter(m => !(m.room in ROOM_ORDER));
  check(badRoom.length === 0, 'ทุกคนอยู่ในห้องที่รู้จัก',
        `${badRoom.length} คนอยู่ในห้องที่ไม่รู้จัก: ${badRoom.slice(0, 5).map(m => `${m.id}/${m.room}`).join(', ')}`);

  // บุคลากรต้องสังกัดห้องที่ตัวเองเป็นครูประจำชั้น ไม่งั้นจะรับฝากขยะในชื่อตัวเองไม่ได้
  const badStaffRoom = staff.filter(m => !(m.room in ROOM_ORDER) && m.room !== STAFF_ROOM);
  check(badStaffRoom.length === 0, 'บุคลากรทุกคนอยู่ในห้องที่รู้จัก',
        `บุคลากร ${badStaffRoom.length} คน room ไม่รู้จัก: ${badStaffRoom.map(m => `${m.id}/${m.room}`).join(', ')}`);

  const central = staff.filter(m => m.room === STAFF_ROOM);
  console.log(`  · บุคลากรที่ไม่ได้เป็นครูประจำชั้น ${central.length} คน (ห้อง "${STAFF_ROOM}" — เฉพาะแอดมินจัดการ): ` +
              central.map(m => m.fullName).join(', '));

  const noOrder = members.filter(m => typeof m.roomOrder !== 'number');
  check(noOrder.length === 0, 'ทุกคนมี roomOrder สำหรับเรียงลำดับ', `${noOrder.length} คนไม่มี roomOrder`);

  const noName = members.filter(m => !m.fullName || m.fullName.length < 2);
  check(noName.length === 0, 'ทุกคนมีชื่อครบ', `${noName.length} คนชื่อว่างหรือสั้นผิดปกติ`);

  // ---------- ห้องกับครู ----------
  console.log('\nห้องและครูผู้รับผิดชอบ');
  const rooms = roomsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const orphanRooms = rooms.filter(r => !(r.teacherUids || []).length);
  check(orphanRooms.length === 0, 'ทุกห้องมีครูรับผิดชอบอย่างน้อย 1 คน',
        `ห้องที่ไม่มีครู: ${orphanRooms.map(r => r.id).join(', ')} — จะไม่มีใครป้อนข้อมูลได้`);

  const roomCounts = {};
  students.forEach(s => { roomCounts[s.room] = (roomCounts[s.room] || 0) + 1; });
  const emptyRooms = Object.keys(ROOM_ORDER).filter(r => !roomCounts[r]);
  check(emptyRooms.length === 0, 'ทุกห้องมีนักเรียน', `ห้องที่ไม่มีนักเรียน: ${emptyRooms.join(', ')}`);

  rooms.sort((a, b) => a.order - b.order)
       .forEach(r => console.log(`  · ${r.id.padEnd(5)} นักเรียน ${String(roomCounts[r.id] || 0).padStart(2)} คน  ครู: ${(r.teacherNames || []).join(', ') || '—'}`));

  // ---------- บัญชีผู้ใช้ ----------
  console.log('\nบัญชีผู้ใช้');
  const accountsFile = JSON.parse(await readFile(join(HERE, 'accounts.json'), 'utf8'));
  check(users.length === accountsFile.accounts.length,
        `users ${users.length} บัญชี ตรงกับ accounts.json`,
        `users ${users.length} แต่ accounts.json มี ${accountsFile.accounts.length}`);

  const admins = users.filter(u => u.role === 'admin');
  check(admins.length >= 1, `แอดมิน ${admins.length} บัญชี`, 'ไม่มีบัญชีแอดมินเลย — จะแก้ประเภทขยะไม่ได้');

  const memberIds = new Set(members.map(m => m.id));
  const badLink = users.filter(u => u.memberId && !memberIds.has(u.memberId));
  check(badLink.length === 0, 'ทุกบัญชีโยงไปยัง member ที่มีอยู่จริง',
        `บัญชีที่ memberId ไม่มีจริง: ${badLink.map(u => u.username).join(', ')}`);

  const teacherNoRoom = users.filter(u => u.role === 'teacher' && !(u.rooms || []).length);
  check(teacherNoRoom.length === 0, 'ครูทุกคนมีห้องรับผิดชอบ',
        `ครูที่ไม่มีห้อง: ${teacherNoRoom.map(u => u.username).join(', ')} — จะป้อนข้อมูลไม่ได้เลย`);

  // ---------- custom claims ต้องตรงกับเอกสาร users ----------
  console.log('\nCustom claims (สิ่งที่ Security Rules ใช้จริง)');
  let claimMismatch = 0;
  for (const u of users) {
    try {
      const rec = await auth.getUserByEmail(usernameToEmail(u.username));
      const c = rec.customClaims || {};
      const sameRooms = JSON.stringify((c.rooms || []).slice().sort())
                     === JSON.stringify((u.rooms || []).slice().sort());
      if (c.role !== u.role || !sameRooms) {
        bad(`${u.username}: claims {role:${c.role}, rooms:${JSON.stringify(c.rooms)}} ` +
            `ไม่ตรงกับเอกสาร {role:${u.role}, rooms:${JSON.stringify(u.rooms)}}`);
        claimMismatch++;
      }
    } catch (e) {
      bad(`${u.username}: ไม่พบบัญชีใน Firebase Auth (${e.code || e.message})`);
      claimMismatch++;
    }
  }
  if (!claimMismatch) ok(`claims ตรงกับเอกสาร users ครบทั้ง ${users.length} บัญชี`);

  // ---------- balances ต้องมี room ไม่งั้น Rules ตรวจสิทธิ์ไม่ได้ ----------
  console.log('\nยอดสรุป');
  const balSample = await db.collection('balances').limit(500).get();
  const noRoom = balSample.docs.filter(d => !d.data().room);
  check(noRoom.length === 0, 'เอกสาร balances มีฟิลด์ room ครบ (Security Rules ต้องใช้)',
        `${noRoom.length} เอกสารไม่มี room — ครูจะอ่าน/เขียนยอดไม่ได้`);

  // ---------- สรุป ----------
  console.log('\n─────────────────────────────────────────');
  if (failures) {
    console.log(`✗ ไม่ผ่าน ${failures} ข้อ — แก้แล้วรัน seed ใหม่`);
    process.exitCode = 1;
  } else {
    console.log('✓ ผ่านทุกข้อ ข้อมูลพร้อมใช้งาน');
  }
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n✗ ตรวจไม่สำเร็จ:', err.message);
  process.exit(1);
});
