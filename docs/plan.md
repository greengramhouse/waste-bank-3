# แผนย้ายฐานข้อมูล EcoPink จาก Google Sheets → Cloud Firestore

## Context

ระบบธนาคารขยะ EcoPink ปัจจุบันใช้ Google Sheets เป็นฐานข้อมูล และ Google Apps Script (`appscript.js`) เป็น backend รับ POST 14 actions หน้าเว็บทั้งสองไฟล์ยิง `fetch` ไปที่ `SCRIPT_URL` เดียวกัน

ปัญหาที่ทำให้ต้องย้าย:
- **Apps Script ช้าและมีโควต้า** — ทุกคำขอต้องผ่าน `LockService` (คิวทีละคน) และอ่าน `getDataRange()` ทั้งชีตทุกครั้ง
- **หน้าบ้านโหลดธุรกรรมทั้งหมดมาคำนวณเอง** — ปีนี้ชีต Transactions ยังว่าง แต่พอสะสมหลักหมื่นแถวจะช้ามาก
- **ความสัมพันธ์ "ครูคนนี้คุมห้องไหน" เดาจากการจับคู่สตริงชื่อ** (`getAdvisorRoomsMap()` ใน `appscript.js:551`) ต้องถอยไปเทียบชื่อต้นเมื่อนามสกุลสะกดไม่ตรง (เสาวงษ์/เสาวงศ์) — เปราะและพังเงียบ
- **บัญชีแอดมิน 2 ใน 3 รหัสผ่านว่าง** (`gukkghu`, `mayp`) → ล็อกอินไม่ได้

ผลลัพธ์ที่ต้องการ: `index.html` (ครู/แอดมิน) ทำงานบน Firestore + Firebase Auth โดย **ฟีเจอร์และหน้าตาเหมือนเดิมทุกอย่าง** เร็วขึ้น ปลอดภัยขึ้น และแก้จุดที่ออกแบบขัดกันของเดิม

---

## ขอบเขตที่ตกลงกันแล้ว

| หัวข้อ | ข้อสรุป |
|---|---|
| สถาปัตยกรรม | หน้าบ้านคุย Firestore ตรงผ่าน Firebase Web SDK + Security Rules (ไม่มี Cloud Functions → ใช้แผน **Spark ฟรี** ได้) |
| โฮสต์ | GitHub Pages (เดิม) — ไม่ย้าย |
| ขอบเขตไฟล์ | **เฉพาะ `index.html`** — `student.html` คงไว้เฉย ๆ ไม่แตะ |
| สิทธิ์ | ครู + แอดมิน เท่านั้น ครูเห็นเฉพาะห้องตัวเอง |
| ล็อกอิน | Firebase Auth Email/Password + **อีเมลสังเคราะห์** `{username}@ecopink.local` |
| บัญชีครู | **1 บัญชีต่อครู 1 คน** (17 คน) + แอดมิน |
| ข้อมูลที่ย้าย | นักเรียน 284 + บุคลากร 19 + ประเภทขยะ 2 → **ธุรกรรมเริ่มใหม่หมด** |
| ความเข้มงวด | คุมด้วยสิทธิ์อ่าน/เขียนพอ ไม่ต้องบังคับ invariant ยอดเงินใน Rules |

---

## ⚠️ จุดติดขัดที่ต้องรับทราบก่อนเริ่ม

1. **`student.html` จะหลุดจากระบบ** — มันยังยิงไป Apps Script/ชีตเดิม เมื่อครูเริ่มบันทึกลง Firestore นักเรียนจะไม่เห็นรายการใหม่ และแต้มจะไม่ขยับ
   → **ทางเลือก:** ปิดลิงก์หน้านักเรียนชั่วคราว หรือขึ้นป้าย "ปิดปรับปรุง" จนกว่าจะทำเฟส 2
2. **แต้มนักเรียนจะกลับเป็น 0** เพราะประวัติเริ่มใหม่ — เกาะ/ไอเทมที่ซื้อไว้ (มี 1 คน) จะติดลบเชิงตรรกะ ถ้าไม่อยากให้เป็นแบบนั้น ต้องล้าง `GameState` ด้วย
3. **API key ของ Firebase จะอยู่ในโค้ดบน GitHub แบบ public** — ปกติสำหรับ Firebase Web แต่หมายความว่า **Security Rules คือกำแพงเดียว** ต้องเขียนให้แน่น + จำกัด API key ด้วย HTTP referrer ใน Google Cloud Console
4. **โควต้า Spark: อ่าน 50,000 / เขียน 20,000 ต่อวัน** — ถ้าแอดมินกดรีเฟรชแล้วโหลดธุรกรรมทั้งโรงเรียนซ้ำ ๆ จะกินโควต้า → ต้องกรองด้วย `schoolYear` + `room` เสมอ
5. **Custom claims รีเฟรชช้า** — เปลี่ยน role/ห้องของครูแล้ว token เดิมยังถืออันเก่าได้ถึง 1 ชม. ต้องให้ผู้ใช้ล็อกเอาต์/เข้าใหม่
6. **Firestore ไม่มี `LockService`** — ใช้ `writeBatch` + `FieldValue.increment()` แทน (อะตอมมิกโดยไม่ต้องอ่านก่อน)

---

## โครงสร้างข้อมูลใหม่ใน Firestore

ออกแบบให้ **แบน เรียบง่าย และแก้จุดที่เดิมขัดกัน**

### `members/{memberId}` — คนทุกคนที่ฝากขยะได้ (นักเรียน + บุคลากร)
รวมชีต `Data` ทั้ง 303 แถวเป็นคอลเลกชันเดียว โดยแยกด้วยฟิลด์ `type` แทนการดูว่าคอลัมน์ F เขียนว่า "ครู" หรือไม่

```
memberId = รหัสนักเรียน/รหัสบุคลากร เช่น "6494", "1007"
{
  id: "6494",
  title: "เด็กชาย", name: "ทณัฐ", surname: "ขวัญศรี",
  fullName: "เด็กชายทณัฐ ขวัญศรี",     // คำนวณล่วงหน้า ใช้แสดงผล/ค้นหา
  room: "อ.2",                          // staff ใช้ "ส่วนกลาง"
  roomOrder: 1,                         // แก้ปัญหา localeCompare เรียง อ.2 ผิด
  type: "student" | "staff",
  position: "ชำนาญการ",                 // staff เท่านั้น (เดิมยัดอยู่ในคอลัมน์ "ห้อง")
  active: true,
  schoolYear: "2569"
}
```

### `rooms/{roomId}` — 11 ห้อง (`roomId` = ชื่อห้อง เช่น `"ป.5"`)
```
{ name: "ป.5", order: 7, teacherUids: [...], teacherNames: ["ครูเสฏฐวุฒิ นิลกระ", "ครูนที นวลขำ"] }
```
**นี่คือจุดที่แก้ความขัดแย้งใหญ่ที่สุด** — ความสัมพันธ์ครู↔ห้องกลายเป็นฟิลด์จริง แทน `normalizeTeacherName_()` + `byFirstName` fallback ที่ `appscript.js:551-620`

### `users/{uid}` — บัญชีผู้ใช้ (uid จาก Firebase Auth)
```
{ username: "Sb", email: "sb@ecopink.local", name: "ครูสมสุข บุญต้อม",
  role: "teacher" | "admin", rooms: ["อ.2"], memberId: "1007", active: true }
```
`memberId` โยงกลับไป `members` → ครูฝากขยะในชื่อตัวเองได้เหมือนเดิม

### `wasteTypes/{typeId}`
```
{ name: "ขวดพลาสติก", price: 8, points: 3, active: true, order: 1 }
```

### `transactions/{autoId}` — ธุรกรรมทั้งหมด
```
{
  type: "deposit" | "withdraw",        // ← ฟิลด์ใหม่ แทนการเดาจากข้อความ
  schoolYear: "2569",
  date: "2026-09-03",                  // string yyyy-mm-dd (รูปแบบเดียวกับที่หน้าบ้านใช้อยู่)
  createdAt: serverTimestamp(),
  memberId: "6494", memberName: "เด็กชายทณัฐ ขวัญศรี", room: "อ.2",
  wasteTypeId: "W4918", wasteTypeName: "ขวดพลาสติก",   // withdraw ใช้ "ถอนเงินออก" เหมือนเดิม
  weight: 2.5, amount: 20, points: 7,   // amount ติดลบเมื่อถอน (คงพฤติกรรมเดิม)
  recordedByUid: "...", recordedByName: "ครูสมสุข บุญต้อม"
}
```

### `deletedTransactions/{sameId}` — ที่เก็บรายการที่ถูกลบ (ใหม่)
เดิม `deleteTransaction()` ลบแถวทิ้งถาวร ตรวจสอบย้อนหลังไม่ได้ ของใหม่ลบแล้วย้ายมาที่นี่ในแบตช์เดียวกัน พร้อม `deletedAt` / `deletedByUid`

### `balances/{memberId}` — ยอดสรุปรายคน (ใหม่)
```
{ totalDeposit, totalWithdraw, balance, totalPoints, totalWeight, lastTxAt }
```
อัปเดตด้วย `FieldValue.increment()` ในแบตช์เดียวกับการเขียน/ลบธุรกรรม → หน้า **ถอนเงิน** และ **ค้นหายอดรายคน** ไม่ต้องสแกนธุรกรรมทั้งหมดอีกต่อไป

---

## Firebase Auth: บัญชีผู้ใช้ใหม่ (19 บัญชี)

แตกบัญชีห้องที่ใช้ร่วมกันออกเป็นรายคน `role`/`rooms` ยิงเข้า **custom claims** ด้วยสคริปต์ admin ในเครื่อง (ไม่ต้องใช้ Cloud Functions → Rules อ่าน `request.auth.token.role` ได้ทันที ไม่เสียโควต้า read)

| ห้อง | ครู | memberId | username (เดิม→ใหม่) |
|---|---|---|---|
| อ.2 | ครูสมสุข บุญต้อม | 1007 | `Sb` |
| อ.3 | ครูกมลทิพย์ หมื่นสา | 1009 | `Km` |
| ป.1 | ครูสุภาพร เสาวงษ์ | 1015 | `Sp` |
| ป.2 | ครูมาริสา อายินดี | 1013 | `Ms` |
| ป.3 | ครูมัทธุรส กาศักดิ์ | 1014 | `Mg` |
| ป.4 | ครูกรุณา นิลกระ | 1005 | `Kn` |
| ป.5 | ครูเสฏฐวุฒิ นิลกระ | 1006 | `Sn` |
| ป.5 | ครูนที นวลขำ | 1016 | `Nn` *(ใหม่)* |
| ป.6 | ครูเยาวรัตน์ สาละผล | 1002 | `Ys` |
| ป.6 | ครูปราณี จันทร์มะลิ | 1012 | `Pj` *(ใหม่)* |
| ม.1 | ครูรัตนา โครงกระโทก | 1017 | `Rnk` |
| ม.1 | ครูธราภร บำรัมย์ | 1011 | `Tb` *(ใหม่)* |
| ม.2 | ครูลัดดาวัลย์ รัตนบุตรชัย | 1004 | `Lwr` |
| ม.2 | ครูฐเดช รวบรวม | 1010 | `Tr` *(ใหม่)* |
| ม.3 | ครูสุกัลยา ขำเถื่อน | 1003 | `Sk` *(ใหม่)* |
| ม.3 | ครูอาทิตติยา ป้อมทอง | 1008 | `Ayp` → **role: admin** |
| — | ผู้อำนวยการ อรุโณทัย ชัยมงคล | 1001 | `ac` → admin |
| — | วรุณพร รัตนบุตรชัย (ธุรการ) | 1018 | `gukkghu` → admin |

- **รหัส `1234` เดิมใช้ไม่ได้** เพราะ Firebase บังคับอย่างน้อย 6 ตัวอักษร ต้องตั้งใหม่ทุกบัญชี — จุดนี้ต้องแจ้งครูทุกคน
  ทำแล้วเมื่อ 4 ก.ย. 2569 ด้วย `npm run set-passwords -- --apply` ซึ่งสุ่มรหัสรายคน **ห้ามใช้รหัสเดียวกันทั้งโรงเรียน**
- `1019 ส่วนกลาง` เป็น member อย่างเดียว ไม่มีบัญชีล็อกอิน

---

## Security Rules (โครงร่าง)

```js
function signedIn()  { return request.auth != null; }
function role()      { return request.auth.token.role; }        // จาก custom claims
function myRooms()   { return request.auth.token.rooms; }
function isAdmin()   { return signedIn() && role() == 'admin'; }
function isStaff()   { return signedIn() && (role() == 'admin' || role() == 'teacher'); }

match /members/{id} {
  allow read:  if isAdmin() || (isStaff() && (resource.data.type == 'staff'
                                            || resource.data.room in myRooms()));
  allow write: if isAdmin();
}
match /rooms/{id}      { allow read: if isStaff(); allow write: if isAdmin(); }
match /wasteTypes/{id} { allow read: if isStaff(); allow write: if isAdmin(); }
match /users/{uid}     { allow read: if isAdmin() || request.auth.uid == uid;
                         allow write: if false; }              // แก้ผ่านสคริปต์ admin เท่านั้น
match /balances/{id}   { allow read: if isStaff(); allow write: if isStaff(); }
match /transactions/{id} {
  allow read:   if isAdmin() || (isStaff() && resource.data.room in myRooms());
  allow create: if isStaff() && request.resource.data.recordedByUid == request.auth.uid
                             && (isAdmin() || request.resource.data.room in myRooms());
  allow delete: if isAdmin() || (isStaff() && resource.data.room in myRooms());
  allow update: if false;                                       // แก้ไม่ได้ ลบแล้วสร้างใหม่
}
match /deletedTransactions/{id} { allow read: if isAdmin(); allow create: if isStaff(); }
```

หมายเหตุ: ครูต้อง query ด้วย `where('room','==', myRoom)` เสมอ ไม่งั้น Rules จะปฏิเสธทั้ง query (เป็นพฤติกรรมปกติของ Firestore list rules)

### Composite indexes ที่ต้องสร้าง (`firestore.indexes.json`)
- `transactions`: `schoolYear ASC, room ASC, createdAt DESC`
- `transactions`: `schoolYear ASC, createdAt DESC`
- `transactions`: `memberId ASC, createdAt DESC`
- `members`: `schoolYear ASC, room ASC, id ASC`

---

## แผนงานเป็นเฟส

### เฟส 0 — เตรียม Firebase (ไม่แตะโค้ด)
1. สร้างโปรเจกต์ Firebase (แผน Spark) เปิด **Firestore** (โหมด production, region `asia-southeast1`)
2. เปิด **Authentication → Email/Password**
3. **Authentication → Settings → Authorized domains** เพิ่มโดเมน GitHub Pages (`<user>.github.io`) และ `localhost`
4. Google Cloud Console → Credentials → จำกัด Browser API key ด้วย HTTP referrer เป็นโดเมนข้างต้น
5. ดาวน์โหลด service account key เก็บไว้นอก repo (ใส่ `.gitignore`)

### เฟส 1 — เขียนสคริปต์ย้ายข้อมูล (`tools/`)
| ไฟล์ | หน้าที่ |
|---|---|
| `tools/export-sheets.mjs` | ดึงชีต Data / Users / WasteTypes ผ่าน gviz CSV endpoint (พิสูจน์แล้วว่าชีตเปิดสาธารณะ ดึงได้) → เขียนเป็น JSON |
| `tools/accounts.json` | ตารางบัญชี 19 รายการข้างต้น (username, email, รหัสเริ่มต้น, name, role, rooms, memberId) — แก้ด้วยมือได้ |
| `tools/seed-firestore.mjs` | ใช้ `firebase-admin` เขียน `members` (303) / `rooms` (11) / `wasteTypes` (2) / `users` (19) แบบ batch, สร้าง Auth users, ตั้ง custom claims `{role, rooms}` |
| `tools/verify.mjs` | นับจำนวนเอกสารและตรวจว่าทุกห้องมีครูอย่างน้อย 1 คน ทุก user มี `memberId` ที่มีอยู่จริง |

จุดที่ต้องทำความสะอาดตอน seed:
- ตัดช่องว่างซ้อนในชื่อ (`"ครูเสฏฐวุฒิ  นิลกระ"`) — ใช้ตรรกะเดียวกับ `normalizeTeacherName_()` (`appscript.js:545`) แต่ทำครั้งเดียวตอนย้าย ไม่ต้องทำ runtime อีก
- แยกฟิลด์ `Name` ที่คั่นด้วย `|` ในชีต Users ออกเป็นครูรายคน
- ย้าย "ชำนาญการพิเศษ/ครู/ธุรการ" จากคอลัมน์ `ห้อง` ของแถวบุคลากร ไปเป็นฟิลด์ `position` และตั้ง `room = "ส่วนกลาง"`
- ใส่ `roomOrder` ตามลำดับ อ.2, อ.3, ป.1…ป.6, ม.1…ม.3

### เฟส 2 — วาง Rules + Indexes
`firestore.rules` และ `firestore.indexes.json` ตามด้านบน ทดสอบด้วย `@firebase/rules-unit-testing` บน emulator ก่อน deploy

### เฟส 3 — เปลี่ยนชั้นข้อมูลใน `index.html` (ใจกลางงาน)

**หลักการ: ไม่แตะ UI / ตรรกะการแสดงผล / ชื่อฟังก์ชันเดิมแม้แต่บรรทัดเดียว** เปลี่ยนเฉพาะ `callBackend()` ให้เป็นอะแดปเตอร์คุย Firestore ที่ **คืนค่ารูปแบบเดิมเป๊ะ** → 12 จุดที่เรียก `callBackend` (`index.html:1262, 1539, 1612, 1764, 1821-1822, 1985, 2586, 2635, 2662, 3458`) ใช้งานได้โดยไม่ต้องแก้

1. **เพิ่ม SDK แบบ compat** ใน `<head>` (ห้ามใช้ modular `type="module"` เพราะโค้ดเดิมใช้ `onclick=` เรียกฟังก์ชัน global):
   ```html
   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
   ```
2. **แทนที่ `const SCRIPT_URL`** (`index.html:1201`) ด้วย `firebaseConfig` + `firebase.initializeApp()`
3. **เขียน `callBackend(action, payload)` ใหม่** (`index.html:1236-1252`) เป็น dispatcher:

| action | การทำงานใหม่ | รูปแบบผลลัพธ์ (ต้องเหมือนเดิม) |
|---|---|---|
| `login` | `signInWithEmailAndPassword(username+'@ecopink.local', pass)` → อ่าน `users/{uid}` → โหลด members ที่มีสิทธิ์ + rooms | `{status, user:{username,name,room,level}, role, students[], allRooms[]}` |
| `getWasteTypes` | query `wasteTypes` where `active==true` order `order` | `{status, data:[{id,name,price,points}]}` |
| `getStudents` | admin: ทั้งหมด / ครู: `where room == myRoom` + `where type=='staff'` | `{status, students:[{id,title,name,surname,room,isTeacher,advisorRooms,gameState,recycleState}]}` |
| `saveTransaction` | รองรับทั้ง object เดี่ยวและ array — `writeBatch` เขียน tx + `increment()` ที่ `balances` | `{status, message}` |
| `getTransactions` | query ตาม `schoolYear` + `room` (ครู) หรือทั้งหมด (admin) order `createdAt desc` | `{status, data:[{timestamp,date,studentId,studentName,room,wasteType,weight,price,points,teacherName,txId}]}` |
| `deleteTransaction` | `writeBatch`: อ่าน doc → ลบ + สร้างใน `deletedTransactions` + `increment()` กลับที่ `balances` | `{status, message}` |
| `saveWasteType` / `editWasteType` / `deleteWasteType` | เขียน/แก้/ปิด `active` ใน `wasteTypes` | `{status, message}` |

4. **ฟิลด์เข้ากันได้**: อะแดปเตอร์ต้องแปลง `memberId → studentId`, `memberName → studentName`, `amount → price`, `wasteTypeName → wasteType`, `recordedByName → teacherName`, `docId → txId` ก่อนคืนค่า และคืน `gameState: "{}"` / `recycleState: "{}"` ค้างไว้ เพื่อไม่ให้โค้ดเดิมพัง
5. **`isTeacher` / `advisorRooms`**: อ่านจาก `members.type == 'staff'` และ `rooms` collection ตรง ๆ — `visibleStudents()` (`index.html:1371`) และ `visibleTransactions()` (`index.html:1387`) ใช้งานได้ทันทีโดยไม่ต้องแก้

### เฟส 4 — เก็บของที่ขัดแย้ง + ปรับให้ดีกว่าเดิม
1. **จำการล็อกอิน** — `onAuthStateChanged` บน page load: ถ้ามี session อยู่แล้วให้ข้ามหน้าล็อกอินเข้าแอปเลย (เดิมรีเฟรชทีต้องล็อกอินใหม่ทุกครั้ง)
2. **เรียงห้องถูกต้อง** — `getAllRoomsInfo()` เดิมใช้ `localeCompare` ทำให้ อ.2 อยู่ท้ายสุด เปลี่ยนไปเรียงตาม `rooms.order`
3. **ปุ่มรีเฟรชเบาลง** — `loadTransactions()` (`index.html:1815`) กรองด้วย `schoolYear` ปัจจุบันเสมอ ไม่ดึงประวัติทุกปี
4. **ยอดคงเหลืออ่านจาก `balances`** — `getWithdrawBalance()` (`index.html:3236`) และ `getBalanceRows()` (`index.html:2818`) เปลี่ยนไปอ่านเอกสารสรุป (ยังคำนวณสำรองจาก `transactions` ได้ถ้า balances ไม่มี)
5. **บันทึกครูผู้ทำรายการเป็น uid** ไม่ใช่แค่ชื่อ → `renderTeacherSummary()` (`index.html:2384`) จะแยกครูคู่ห้องเดียวกันได้จริง (เดิม ป.5/ป.6/ม.1-3 ใช้บัญชีร่วม แยกไม่ออก)
6. **ลบแล้วยังตรวจสอบได้** — `deleteTx()` (`index.html:1969`) ยิงไป soft-archive แทนการลบถาวร
7. เก็บ `MIN_WITHDRAW_BALANCE` (50 บาท) และ `ADMIN_ONLY_TABS` (`settings`, `withdraw`) ไว้เหมือนเดิม

### เฟส 5 — ทดสอบ
รันทีละแท็บด้วยบัญชีครู 1 คน + แอดมิน 1 คน (checklist ในหัวข้อ Verification)

### เฟส 6 — ตัดระบบ
1. Deploy `index.html` ขึ้น GitHub Pages
2. แขวนป้าย/ปิดลิงก์ `student.html` พร้อมข้อความ "ปิดปรับปรุง"
3. ตั้งชีต Google Sheets เป็น read-only เก็บไว้เป็น backup แต่ **อย่าลบ deployment ของ Apps Script ทันที** เผื่อต้องย้อนกลับใน 1-2 สัปดาห์แรก
4. เขียนคู่มือสั้น ๆ: รายชื่อบัญชี/รหัสใหม่, วิธีเพิ่มนักเรียนปีถัดไป (รัน `seed-firestore.mjs` ด้วย `schoolYear` ใหม่)

---

## ไฟล์ที่แตะ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `index.html` | เปลี่ยนเฉพาะบล็อก `SCRIPT_URL` + `callBackend` (บรรทัด ~1198-1252) และจุดแก้ในเฟส 4 — UI/HTML ไม่แตะ |
| `student.html` | **ไม่แตะ** |
| `appscript.js` | **ไม่แตะ** (เก็บไว้เป็น fallback) |
| `firestore.rules` | ใหม่ |
| `firestore.indexes.json` | ใหม่ |
| `firebase.json` | ใหม่ (สำหรับ deploy rules + รัน emulator) |
| `tools/*.mjs`, `tools/accounts.json` | ใหม่ — สคริปต์ย้ายข้อมูลแบบรันครั้งเดียว |
| `plan.md` | ใหม่ — สำเนาแผนนี้ตามที่ขอ |

---

## Verification

### 1. ทดสอบ Rules บน emulator ก่อนแตะของจริง
```
firebase emulators:start --only firestore,auth
node tools/seed-firestore.mjs --emulator
npm test        # @firebase/rules-unit-testing
```
เคสที่ต้องผ่าน: ครู ป.5 อ่าน members ห้อง ป.5 ได้ / อ่านห้อง ม.3 **ไม่ได้** / อ่าน staff ได้ / แอดมินอ่านได้ทุกห้าง / ผู้ไม่ล็อกอินอ่านไม่ได้เลย / ครูสร้าง tx ห้องอื่นไม่ได้

### 2. ตรวจข้อมูลหลัง seed
```
node tools/verify.mjs
```
คาดหวัง: `members` 303 (student 284 / staff 19), `rooms` 11, `users` 19, `wasteTypes` 2, `transactions` 0

### 3. Checklist ทดสอบหน้าเว็บ (ทำครบทั้ง 10 แท็บ ด้วยบัญชีครู 1 + แอดมิน 1)
- [ ] **ล็อกอิน** ครู → เห็นชื่อ+ห้องถูก, แท็บ `ตั้งค่า`/`ถอนเงิน` ถูกซ่อน
- [ ] **ล็อกอิน** แอดมิน → เห็นครบทุกแท็บ, `allRooms` เรียง อ.2 → ม.3
- [ ] **รับฝาก** — ค้นหานักเรียน, เลือกประเภทขยะ, ยอดเงิน/แต้มคำนวณตรง, บันทึกแล้วรายการโผล่ในประวัติ
- [ ] **รับฝาก** ในชื่อครูตัวเอง (บุคลากร) ได้
- [ ] **รับฝากด่วน** — กรอกหลายคนแล้วกดบันทึกทีเดียว (ทดสอบ batch write) ครบทุกรายการ
- [ ] **ถอนเงิน** — ยอดต่ำกว่า 50 บาทถอนไม่ได้, ถอนเกินยอดไม่ได้, ถอนแล้วยอดลดถูกต้อง
- [ ] **ประวัติ** — กรองตามวันที่, ลบรายการแล้วยอดใน `balances` ถอยกลับถูกต้อง และมี doc ใน `deletedTransactions`
- [ ] **ค้นหายอดรายคน** — ตัวกรองยอดเงิน + พิมพ์ PDF ภาษาไทยไม่เพี้ยน
- [ ] **สรุปรายคน / รายห้อง / รายครู** — กราฟและ Top 5 ขึ้นครบ, สรุปรายครูแยกครูคู่ห้องเดียวกันได้แล้ว
- [ ] **รายงาน** — เลือกช่วงวันที่ แล้ว export PDF (`exportReportToPDF()`) ออกมาถูก
- [ ] **ตั้งค่า** (แอดมิน) — เพิ่ม/แก้/ลบประเภทขยะ แล้วหน้ารับฝากเห็นผลทันที
- [ ] **ครูห้อง ป.5 มองไม่เห็นข้อมูลห้อง ม.3** ทั้งในรายชื่อและประวัติ
- [ ] รีเฟรชหน้า → ยังล็อกอินอยู่ (ฟีเจอร์ใหม่)

### 4. ตรวจโควต้า
เปิด Firebase Console → Usage หลังทดสอบ 1 วัน ดูว่า reads/writes ห่างจากเพดาน Spark มากพอ
