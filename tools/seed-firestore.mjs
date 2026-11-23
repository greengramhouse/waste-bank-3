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
  cleanName, isStaffRow, usernameToEmail, stripTeacherPrefix, EMAIL_DOMAIN,
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

  await addStaffFromAccounts(members, accountsFile, staffRoomByMemberId, seen);

  const students = members.filter(m => m.doc.type === 'student').length;
  const staff = members.length - students;
  console.log(`\n[1/5] members — นักเรียน ${students} คน, บุคลากร ${staff} คน`);
  problems.forEach(p => console.warn(`  ⚠ ${p}`));

  await commitInChunks('members', members,
    (batch, m) => batch.set(db.collection('members').doc(m.id), m.doc, { merge: true }));

  return members;
}

/**
 * ครูที่ย้ายมาใหม่หลังดึงชีต — มีใน accounts.json แต่ไม่มีใน Data.json
 *
 * ถ้าไม่สร้างให้ ครูจะล็อกอินได้แต่รับฝากขยะในชื่อตัวเองไม่ได้ (ไม่มี members/balances)
 * และ export-sheets รอบหน้าจะไม่ทำให้หายไป เพราะ seed ใช้ merge ไม่ลบเอกสาร
 *
 * ถ้าแอดมินเพิ่มคนนี้จากหน้าเว็บไว้แล้ว เก็บชื่อ/คำนำหน้าที่แอดมินกรอกไว้ แก้แค่ห้อง
 * ถ้ายังไม่มี สร้างจากชื่อใน accounts.json — ไม่รู้คำนำหน้าจริง จึงใช้ "ครู" แทนการเดาเพศ
 */
async function addStaffFromAccounts(members, accountsFile, staffRoomByMemberId, seen) {
  const extra = accountsFile.accounts.filter(a => a.memberId && !seen.has(a.memberId));
  if (!extra.length) return;

  const snaps = await db.getAll(...extra.map(a => db.collection('members').doc(a.memberId)));
  extra.forEach((acc, i) => {
    const id = acc.memberId;
    const room = staffRoomByMemberId[id] || STAFF_ROOM;
    const roomFields = {
      room,
      roomOrder: ROOM_ORDER[room] ?? STAFF_ROOM_ORDER,
      type: 'staff',
      active: true,
      schoolYear: SCHOOL_YEAR,
      updatedAt: FieldValue.serverTimestamp(),
    };

    let doc;
    if (snaps[i].exists) {
      const cur = snaps[i].data();
      doc = { ...roomFields, fullName: cur.fullName || acc.name };
      console.log(`  ↻ บุคลากร ${id} ${doc.fullName} มีในระบบแล้ว (ไม่อยู่ในชีต) — ปรับห้องเป็น ${room}`);
    } else {
      const [name, ...rest] = stripTeacherPrefix(acc.name).split(' ');
      doc = {
        id, title: 'ครู', name, surname: rest.join(' '),
        fullName: `ครู${name} ${rest.join(' ')}`.trim(),
        position: 'ครู',
        ...roomFields,
      };
      console.log(`  + บุคลากรใหม่ ${id} ${doc.fullName} ห้อง ${room} (จาก accounts.json — ไม่มีในชีต)`);
    }
    seen.add(id);
    members.push({ id, doc });
  });
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
  // ไม่มีรหัสสำรองฝังในโค้ด — repo นี้เป็น public ใครก็อ่านได้
  // บัญชีที่ไม่มีรหัสจะถูกข้าม แล้วให้ไปตั้งด้วย set-passwords.mjs ซึ่งสุ่มรายคน
  const defaultPassword = accountsFile.defaultPassword || '';
  const accounts = accountsFile.accounts;

  console.log(`\n[4/5] บัญชีผู้ใช้ — ${accounts.length} บัญชี`);

  for (const acc of accounts) {
    const email = usernameToEmail(acc.username);
    const password = acc.password || defaultPassword;

    if (!password) {
      console.warn(`  ⚠ ${acc.username}: ไม่มีรหัสผ่านใน accounts.json — ข้าม`);
      console.warn(`     ตั้งรหัสสุ่มให้ด้วย: node tools/set-passwords.mjs --apply --only ${acc.username}`);
      continue;
    }
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
      // disabled: false — ครูที่เคยถูกปิดบัญชี (ย้ายออก) แล้วกลับมา ใส่ชื่อคืนใน accounts.json ก็ใช้ได้ทันที
      await auth.updateUser(user.uid, { displayName: acc.name, disabled: false });
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

  await disableRemovedAccounts(accounts);
  return accounts;
}

/**
 * ปิดบัญชีของครูที่ถูกเอาออกจาก accounts.json (ย้ายโรงเรียน / ลาออก)
 *
 * "ปิด" ไม่ใช่ "ลบ" — ธุรกรรมเก่าเก็บ recordedByUid ไว้ ลบบัญชีแล้วสืบย้อนไม่ได้ว่าใครบันทึก
 * ส่วนบัญชีขายขยะ (members/balances) ของครูคนนั้นไม่แตะ ยอดเงินยังอยู่ให้แอดมินถอนคืนได้
 *
 * ทำสามชั้นเพราะแต่ละชั้นกันคนละช่อง:
 *   disabled: true          ล็อกอินใหม่ไม่ได้ และต่ออายุ token ไม่ได้
 *   revokeRefreshTokens     ตัด session ที่ค้างอยู่บนมือถือครู
 *   claims ว่าง + active:false   token ที่ยังไม่หมดอายุ (≤1 ชม.) ก็ผ่าน Rules ไม่ได้
 */
async function disableRemovedAccounts(accounts) {
  const keep = new Set(accounts.map(a => usernameToEmail(a.username)));
  const stale = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    page.users.forEach(u => {
      if (u.email?.endsWith(`@${EMAIL_DOMAIN}`) && !keep.has(u.email) && !u.disabled) stale.push(u);
    });
    pageToken = page.pageToken;
  } while (pageToken);

  if (!stale.length) return;

  for (const u of stale) {
    const label = `${u.email.split('@')[0].padEnd(9)} ${u.displayName || ''}`;
    if (DRY_RUN) { console.log(`  [dry] ✗ ปิดบัญชี ${label} (ไม่อยู่ใน accounts.json แล้ว)`); continue; }
    await auth.updateUser(u.uid, { disabled: true });
    await auth.revokeRefreshTokens(u.uid);
    await auth.setCustomUserClaims(u.uid, null);   // ล้าง role/rooms ทั้งหมด
    await db.collection('users').doc(u.uid).set({
      active: false, rooms: [], disabledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✗ ปิดบัญชี ${label} (ไม่อยู่ใน accounts.json แล้ว)`);
  }
}

// ---------------------------------------------------------------- 5. balances

/**
 * สร้างเอกสารยอดสรุปเปล่าไว้ล่วงหน้าให้ทุกคน
 *
 * เหตุผลสองข้อ:
 *  1. Security Rules ตรวจสิทธิ์จาก resource.data.room ในเอกสารนี้ ถ้าไม่มีเอกสารก็ตรวจไม่ได้
 *  2. หน้า "ค้นหายอดรายคน" อ่านจากที่นี่ ไม่ต้องสแกน transactions ทั้งหมด
 *
 * เอกสารเดิมไม่ถูกเขียนทับยอด เพื่อไม่ให้รันซ้ำแล้วยอดที่สะสมไว้ถูกล้างเป็นศูนย์
 *
 * แต่ "ห้อง" ของเอกสารเดิมต้องตามห้องใน members เสมอ (ดู syncBalanceRooms)
 */
async function seedBalances(members) {
  console.log(`\n[5/5] balances — สร้างเอกสารที่ยังไม่มี และปรับห้องให้ตรงกับ members`);

  // อ่านเฉพาะฟิลด์ห้อง ไม่ดึงตัวเลขยอดมาเลย — ส่วนนี้ไม่มีทางไปแตะยอดเงินได้
  const existing = new Map();
  const snap = await db.collection('balances').select('room', 'roomOrder').get();
  snap.forEach(d => existing.set(d.id, d.data()));

  await syncBalanceRooms(members, existing);

  const missing = members.filter(m => !existing.has(m.id));
  if (!missing.length) {
    console.log(`  ✓ มีเอกสารครบทุกคนแล้ว (${existing.size} เอกสาร) ไม่แตะยอดเดิม`);
    return;
  }

  missing.forEach(m => console.log(`  + ${m.id.padEnd(5)} ${m.doc.fullName}  (${m.doc.room}) ยอดเริ่ม 0`));
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
  if (existing.size) console.log(`  (ยอดของเดิม ${existing.size} เอกสาร ไม่ถูกแตะ)`);
}

/**
 * ปรับ room / roomOrder ใน balances ให้ตรงกับ members — แก้แค่สองฟิลด์นี้ ไม่แตะตัวเลขยอดเลย
 *
 * ทำไมต้องมี: ห้องของบุคลากรคำนวณใหม่จาก accounts.json ทุกครั้งที่ seed
 * (ย้ายครูจาก ป.6 ไป ป.4 / เอาครูออกจากระบบแล้วไปอยู่ 'ส่วนกลาง') แต่ balances สร้างครั้งเดียว
 * ห้องในนั้นจึงค้างเป็นห้องเก่า และ Rules ตัดสินสิทธิ์แก้ยอดจาก balances.room
 * → ครูที่ย้ายมา ป.4 รับฝากขยะในชื่อตัวเองไม่ได้ เพราะกฎมองว่าไปเขียนยอดของ ป.6
 *
 * ยึด members ใน Firestore เป็นหลัก แล้วทับด้วยรายการที่ seed รอบนี้เพิ่งคำนวณ
 * เพื่อให้ครอบคลุมคนที่แอดมินเพิ่มจากหน้าเว็บ (ไม่อยู่ใน Data.json) และให้ --dry-run เห็นผลจริง
 *
 * ธุรกรรมเก่าไม่ย้ายห้องตาม — เป็นบันทึกว่าตอนนั้นอยู่ห้องไหน และห้ามแก้ธุรกรรมอยู่แล้ว
 */
async function syncBalanceRooms(seededMembers, existing) {
  const target = new Map();
  const memberSnap = await db.collection('members').select('room', 'roomOrder', 'fullName').get();
  memberSnap.forEach(d => target.set(d.id, d.data()));
  for (const m of seededMembers) target.set(m.id, m.doc);

  const changes = [];
  const orphans = [];
  for (const [id, bal] of existing) {
    const m = target.get(id);
    if (!m || !m.room) { orphans.push(id); continue; }
    // สมาชิกที่เพิ่มจากหน้าเว็บอาจไม่มี roomOrder — Firestore ไม่รับค่า undefined จึงต้องเติมให้
    const roomOrder = m.roomOrder ?? ROOM_ORDER[m.room] ?? STAFF_ROOM_ORDER;
    if (bal.room !== m.room || bal.roomOrder !== roomOrder) {
      changes.push({ id, from: bal.room, to: m.room, roomOrder, name: m.fullName || '' });
    }
  }

  if (orphans.length) {
    console.warn(`  ⚠ balances ที่ไม่มีใน members ${orphans.length} เอกสาร (ไม่แตะ): ${orphans.join(', ')}`);
  }
  if (!changes.length) {
    console.log('  ✓ ห้องใน balances ตรงกับ members ทุกคน');
    return;
  }

  changes.forEach(c => console.log(`  ↻ ${c.id.padEnd(5)} ${c.name}  ห้อง ${c.from ?? '-'} → ${c.to}`));
  await commitInChunks('balances (ปรับห้อง)', changes, (batch, c) =>
    batch.update(db.collection('balances').doc(c.id), { room: c.to, roomOrder: c.roomOrder }));
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
