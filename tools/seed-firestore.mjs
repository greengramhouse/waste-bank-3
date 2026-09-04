/**
 * ย้ายข้อมูลจากชีตเข้า Firestore และสร้างบัญชีผู้ใช้ใน Firebase Auth
 *
 *   node tools/seed-firestore.mjs --emulator     ซ้อมกับ emulator ก่อน (ปลอดภัย)
 *   node tools/seed-firestore.mjs --dry-run      ดูว่าจะเขียนอะไรบ้างโดยไม่เขียนจริง
 *   node tools/seed-firestore.mjs                เขียนลงโปรเจกต์จริง
 *
 * ต้องรัน `node tools/export-sheets.mjs` ก่อน
 *
 * สคริปต์นี้ idempotent — รันซ้ำได้ ข้อมูลจะถูกเขียนทับด้วยค่าล่าสุดจากชีต
 * แต่ **ไม่แตะ transactions และไม่รีเซ็ต balances ที่มียอดแล้ว**
 *
 * ตัวตนที่ใช้เขียน (เลือกอย่างใดอย่างหนึ่ง):
 *   - วางไฟล์ service account ที่ tools/service-account.json
 *   - หรือตั้ง env GOOGLE_APPLICATION_CREDENTIALS ชี้ไปที่ไฟล์นั้น
 *   - โหมด --emulator ไม่ต้องใช้ตัวตนใด ๆ
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import {
  PROJECT_ID, ROOM_ORDER, STAFF_ROOM, STAFF_ROOM_ORDER, SCHOOL_YEAR,
  cleanName, isStaffRow, usernameToEmail,
} from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const SA_PATH = join(HERE, 'service-account.json');

const USE_EMULATOR = process.argv.includes('--emulator');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------- เริ่มระบบ

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
  console.error('✗ ไม่พบตัวตนสำหรับเขียนข้อมูล');
  console.error('  วางไฟล์ service account ที่ tools/service-account.json');
  console.error('  หรือรันด้วย --emulator เพื่อซ้อมก่อน');
  process.exit(1);
}

const db = getFirestore();
const auth = getAuth();

const target = USE_EMULATOR ? 'EMULATOR' : `โปรเจกต์จริง (${PROJECT_ID})`;
console.log(`\n▶ ปลายทาง: ${target}${DRY_RUN ? '  [DRY RUN — ไม่เขียนจริง]' : ''}`);
console.log(`▶ ปีการศึกษา: ${SCHOOL_YEAR}\n`);

// ---------------------------------------------------------------- ตัวช่วย

async function loadJson(name) {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`ไม่พบ ${path} — รัน \`node tools/export-sheets.mjs\` ก่อน`);
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * เขียนทีละ 400 เอกสาร — Firestore จำกัดแบตช์ละ 500 operation
 * เผื่อไว้ 100 เพราะบางรอบมีการเขียนสองเอกสารต่อหนึ่งรายการ
 */
async function commitInChunks(label, items, buildOp) {
  if (DRY_RUN) {
    console.log(`  [dry] ${label}: ${items.length} เอกสาร`);
    return;
  }
  let written = 0;
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const item of items.slice(i, i + 400)) buildOp(batch, item);
    await batch.commit();
    written += Math.min(400, items.length - i);
  }
  console.log(`  ✓ ${label}: ${written} เอกสาร`);
}

// ---------------------------------------------------------------- 1. members

async function seedMembers(dataRows, accountsFile) {
  const members = [];
  const seen = new Set();
  const problems = [];

  /**
   * บุคลากรสังกัด "ห้องที่ตัวเองเป็นครูประจำชั้น" ไม่ใช่ห้องลอย ๆ
   *
   * เพราะ Security Rules ตัดสินสิทธิ์จากฟิลด์ room ตัวเดียว ถ้าครู ป.5 มี room = 'ส่วนกลาง'
   * ครูจะรับฝากขยะในชื่อตัวเองไม่ได้ (กฎมองว่าเขียนข้ามห้อง)
   * ให้ room = 'ป.5' แล้วทุกอย่างเข้าที่: อ่านเจอ เขียนได้ ยอดเดินถูกห้อง
   *
   * คนที่ไม่ได้เป็นครูประจำชั้น (ผอ. / ธุรการ / ส่วนกลาง) อยู่ห้อง 'ส่วนกลาง' ให้แอดมินดูแล
   */
  const staffRoomByMemberId = {};
  for (const acc of accountsFile.accounts) {
    if (acc.memberId && (acc.rooms || []).length) staffRoomByMemberId[acc.memberId] = acc.rooms[0];
  }

  for (const row of dataRows) {
    const id = cleanName(row['รหัสนักเรียน']);
    if (!id) continue;

    if (seen.has(id)) { problems.push(`รหัสซ้ำ: ${id}`); continue; }
    seen.add(id);

    const staff = isStaffRow(row);
    const title = cleanName(row['คำนำหน้า']);
    const name = cleanName(row['ชื่อ']);
    const surname = cleanName(row['นามสกุล']);

    // แถวบุคลากรเก็บ "ตำแหน่ง" ไว้ในคอลัมน์ ห้อง (ชำนาญการพิเศษ / ธุรการ / ผู้อำนวยการ)
    // ย้ายไปฟิลด์ position แล้วตั้ง room เป็นห้องที่เป็นครูประจำชั้น
    const rawRoom = cleanName(row['ห้อง']);
    const room = staff ? (staffRoomByMemberId[id] || STAFF_ROOM) : rawRoom;

    if (!(room in ROOM_ORDER) && room !== STAFF_ROOM) {
      problems.push(`ห้องไม่รู้จัก "${room}" ที่รหัส ${id}`);
    }

    members.push({
      id,
      doc: {
        id,
        title, name, surname,
        fullName: `${title}${name} ${surname}`.trim(),
        room,
        roomOrder: ROOM_ORDER[room] ?? STAFF_ROOM_ORDER,
        type: staff ? 'staff' : 'student',
        ...(staff ? { position: rawRoom } : { advisorText: cleanName(row['ครูที่ปรึกษา']) }),
        active: true,
        schoolYear: SCHOOL_YEAR,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  const students = members.filter(m => m.doc.type === 'student').length;
  const staff = members.length - students;
  console.log(`\n[1/5] members — นักเรียน ${students} คน, บุคลากร ${staff} คน`);
  problems.forEach(p => console.warn(`  ⚠ ${p}`));

  await commitInChunks('members', members,
    (batch, m) => batch.set(db.collection('members').doc(m.id), m.doc, { merge: true }));

  return members;
}

// ---------------------------------------------------------------- 2. rooms

async function seedRooms(accounts) {
  const rooms = Object.entries(ROOM_ORDER).map(([name, order]) => {
    const teachers = accounts.filter(a => (a.rooms || []).includes(name));
    return {
      id: name,
      doc: {
        name,
        order,
        teacherNames: teachers.map(t => t.name),
        teacherUsernames: teachers.map(t => t.username),
        teacherUids: teachers.map(t => t.uid).filter(Boolean),
        // รหัสบุคลากรของครูประจำชั้น — หน้าเว็บใช้ประกอบ advisorRooms โดยไม่ต้องอ่านคอลเลกชัน users
        teacherMemberIds: teachers.map(t => t.memberId).filter(Boolean),
        schoolYear: SCHOOL_YEAR,
        updatedAt: FieldValue.serverTimestamp(),
      },
    };
  });

  console.log(`\n[2/5] rooms — ${rooms.length} ห้อง`);
  const orphans = rooms.filter(r => r.doc.teacherNames.length === 0);
  orphans.forEach(r => console.warn(`  ⚠ ห้อง ${r.id} ไม่มีครูรับผิดชอบ — จะไม่มีใครป้อนข้อมูลได้`));

  await commitInChunks('rooms', rooms,
    (batch, r) => batch.set(db.collection('rooms').doc(r.id), r.doc, { merge: true }));
}

// ---------------------------------------------------------------- 3. wasteTypes

async function seedWasteTypes(rows) {
  const types = rows
    .filter(r => cleanName(r['รหัสประเภท']))
    .map((r, i) => ({
      id: cleanName(r['รหัสประเภท']),
      doc: {
        name: cleanName(r['ชื่อขยะ']),
        price: Number(r['ราคาต่อกก. (บาท)']) || 0,
        points: Number(r['แต้มต่อกก.']) || 0,
        order: i + 1,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
    }));

  console.log(`\n[3/5] wasteTypes — ${types.length} ประเภท`);
  types.forEach(t => console.log(`      ${t.id}  ${t.doc.name}  ${t.doc.price} บาท/กก.  ${t.doc.points} แต้ม/กก.`));

  await commitInChunks('wasteTypes', types,
    (batch, t) => batch.set(db.collection('wasteTypes').doc(t.id), t.doc, { merge: true }));
}

// ---------------------------------------------------------------- 4. บัญชีผู้ใช้

/**
 * สร้าง/อัปเดตบัญชีใน Firebase Auth แล้วตั้ง custom claims
 *
 * claims คือสิ่งที่ Security Rules ใช้ตัดสินสิทธิ์จริง ส่วนเอกสาร users/{uid}
 * เป็นแค่สำเนาไว้ให้หน้าเว็บอ่านชื่อ/ห้องมาแสดง — ทั้งสองที่ต้องตรงกันเสมอ
 */
async function seedUsers(accountsFile, members) {
  const memberIds = new Set(members.map(m => m.id));
  const defaultPassword = accountsFile.defaultPassword || 'ecopink2569';
  const accounts = accountsFile.accounts;

  console.log(`\n[4/5] บัญชีผู้ใช้ — ${accounts.length} บัญชี`);

  for (const acc of accounts) {
    const email = usernameToEmail(acc.username);
    const password = acc.password || defaultPassword;

    if (password.length < 6) {
      console.warn(`  ⚠ ${acc.username}: รหัสสั้นกว่า 6 ตัว Firebase จะปฏิเสธ — ข้าม`);
      continue;
    }
    if (acc.memberId && !memberIds.has(acc.memberId)) {
      console.warn(`  ⚠ ${acc.username}: memberId ${acc.memberId} ไม่มีใน members`);
    }
    for (const r of acc.rooms || []) {
      if (!(r in ROOM_ORDER)) console.warn(`  ⚠ ${acc.username}: ห้อง "${r}" ไม่รู้จัก`);
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${acc.username.padEnd(9)} ${acc.role.padEnd(7)} ${(acc.rooms || []).join(',') || '-'}`);
      acc.uid = `dry-${acc.username}`;
      continue;
    }

    // หาบัญชีเดิมก่อน — รันซ้ำแล้วต้องไม่พังและต้องไม่รีเซ็ตรหัสที่ครูเปลี่ยนเองไปแล้ว
    let user = null;
    try {
      user = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    if (user) {
      await auth.updateUser(user.uid, { displayName: acc.name });
    } else {
      user = await auth.createUser({ email, password, displayName: acc.name, emailVerified: true });
    }
    acc.uid = user.uid;

    await auth.setCustomUserClaims(user.uid, {
      role: acc.role,
      rooms: acc.rooms || [],
      canViewAll: acc.canViewAll === true,
    });

    await db.collection('users').doc(user.uid).set({
      username: acc.username,
      email,
      name: acc.name,
      role: acc.role,
      rooms: acc.rooms || [],
      canViewAll: acc.canViewAll === true,
      memberId: acc.memberId || null,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const tag = user.metadata ? '' : ' (ใหม่)';
    console.log(`  ✓ ${acc.username.padEnd(9)} ${acc.role.padEnd(7)} ${(acc.rooms || []).join(',') || '-'}${tag}`);
  }

  return accounts;
}

// ---------------------------------------------------------------- 5. balances

/**
 * สร้างเอกสารยอดสรุปเปล่าไว้ล่วงหน้าให้ทุกคน
 *
 * เหตุผลสองข้อ:
 *  1. Security Rules ตรวจสิทธิ์จาก resource.data.room ในเอกสารนี้ ถ้าไม่มีเอกสารก็ตรวจไม่ได้
 *  2. หน้า "ค้นหายอดรายคน" อ่านจากที่นี่ ไม่ต้องสแกน transactions ทั้งหมด
 *
 * ใช้ create() ไม่ใช่ set() เพื่อไม่ให้รันซ้ำแล้วยอดที่สะสมไว้ถูกล้างเป็นศูนย์
 */
async function seedBalances(members) {
  console.log(`\n[5/5] balances — ตรวจและสร้างเอกสารที่ยังไม่มี`);

  if (DRY_RUN) {
    console.log(`  [dry] balances: สูงสุด ${members.length} เอกสาร`);
    return;
  }

  const existing = new Set();
  const snap = await db.collection('balances').select().get();
  snap.forEach(d => existing.add(d.id));

  const missing = members.filter(m => !existing.has(m.id));
  if (!missing.length) {
    console.log(`  ✓ ครบอยู่แล้ว (${existing.size} เอกสาร) ไม่แตะยอดเดิม`);
    return;
  }

  await commitInChunks('balances (สร้างใหม่)', missing, (batch, m) => {
    batch.set(db.collection('balances').doc(m.id), {
      memberId: m.id,
      memberName: m.doc.fullName,
      room: m.doc.room,
      roomOrder: m.doc.roomOrder,
      type: m.doc.type,
      totalDeposit: 0,
      totalWithdraw: 0,
      balance: 0,
      totalPoints: 0,
      totalWeight: 0,
      lastTxAt: null,
    });
  });
  if (existing.size) console.log(`  (ของเดิม ${existing.size} เอกสาร ไม่ถูกแตะ)`);
}

// ---------------------------------------------------------------- main

async function main() {
  const [dataRows, wasteRows, accountsFile] = await Promise.all([
    loadJson('Data.json'),
    loadJson('WasteTypes.json'),
    readFile(join(HERE, 'accounts.json'), 'utf8').then(JSON.parse),
  ]);

  const members = await seedMembers(dataRows, accountsFile);
  const accounts = await seedUsers(accountsFile, members);
  await seedRooms(accounts);           // ต้องอยู่หลัง seedUsers เพราะต้องใช้ uid
  await seedWasteTypes(wasteRows);
  await seedBalances(members);

  console.log('\n─────────────────────────────────────────');
  console.log(DRY_RUN ? 'DRY RUN จบแล้ว ไม่ได้เขียนอะไรลงฐานข้อมูล'
                      : 'เสร็จแล้ว — รัน `npm run verify` เพื่อตรวจความถูกต้อง');
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n✗ ล้มเหลว:', err.message);
  if (err.code) console.error('  code:', err.code);
  process.exit(1);
});
