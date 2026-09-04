# EcoPink — ธนาคารขยะรักษ์โลก

ระบบธนาคารขยะโรงเรียนชุมชนวัดไทยงาม
กำลังย้ายฐานข้อมูลจาก Google Sheets ไป Cloud Firestore — แผนเต็มอยู่ที่ [`docs/plan.md`](docs/plan.md)
สถานะงานล่าสุดอยู่ที่ [`docs/progress.md`](docs/progress.md) — **อ่านไฟล์นั้นก่อนทำงานต่อ**

| | |
|---|---|
| หน้าแรก (ระบบเดิม Google Sheets) | https://greengramhouse.github.io/waste-bank-3/ |
| **ระบบใหม่บน Firestore — ที่ครูต้องใช้** | https://greengramhouse.github.io/waste-bank-3/app.html |

> ⚠️ สองระบบอยู่บนโดเมนเดียวกันและหน้าล็อกอินหน้าตาเหมือนกัน
> ระบบใหม่มีป้าย **"ระบบใหม่ · ใช้รหัสผ่านที่ขึ้นต้นด้วย eco-"** ใต้ชื่อเว็บ และชื่อแท็บขึ้นว่า *EcoPink ระบบใหม่*
> รหัส `eco-xxxxx` ใช้กับระบบเดิมไม่ได้ และรหัสเดิมก็ใช้กับระบบใหม่ไม่ได้

---

## โครงสร้างโฟลเดอร์

```
.
├── index.html                  ระบบเดิม (Google Sheets) — ยังใช้งานจริงอยู่ ห้ามแก้
├── student.html                หน้านักเรียนเดิม — ยังไม่ย้าย ห้ามแก้
├── app.html                    ★ ระบบใหม่ (Firestore) — ไฟล์ที่พัฒนาอยู่
│
├── CLAUDE.md                   คู่มือสำหรับ Claude Code — อ่านก่อนแก้โค้ด
├── README.md                   ไฟล์นี้
│
├── docs/
│   ├── plan.md                 แผนการย้ายฐานข้อมูลทีละเฟส
│   ├── progress.md             ★ สถานะงาน — อ่านก่อนทำต่อ
│   └── teacher-guide.html      คู่มือครู 1 แผ่น A4 พิมพ์แจกได้
│
├── firebase/
│   ├── firestore.rules         กฎความปลอดภัย — กำแพงเดียวที่กันข้อมูลจริง
│   └── firestore.indexes.json  ดัชนีผสมสำหรับ query ช่วงวันที่
│
├── legacy/
│   └── appscript.js            backend เดิมบน Google Apps Script (เก็บไว้อ้างอิง/สำรอง)
│
├── tools/                      สคริปต์ย้ายข้อมูล รันในเครื่อง ไม่ได้ deploy
│   ├── config.mjs              ค่าคงที่ + ตัวช่วยเรื่องวันที่/ชื่อ
│   ├── accounts.json           ★ บัญชีครูและแอดมิน + รหัสจริง (gitignored)
│   ├── export-sheets.mjs       ดึงข้อมูลจากชีตมาเป็น JSON
│   ├── seed-firestore.mjs      เขียนลง Firestore + สร้างบัญชี Auth + ตั้ง custom claims
│   ├── verify.mjs              ตรวจความถูกต้องหลังย้าย
│   ├── test-rules.mjs          ทดสอบ Security Rules กับฐานจริง (ล้างข้อมูลทดสอบให้เอง)
│   ├── recompute-balances.mjs  คำนวณยอดคงเหลือใหม่จากธุรกรรมจริง
│   ├── set-passwords.mjs       สุ่มรหัสผ่านรายคนแล้วอัปเดตเข้า Firebase Auth
│   ├── make-handout.mjs        ใบแจ้งบัญชีรายคนไว้พิมพ์แจกครู
│   ├── switch-live.mjs         สลับว่าหน้าแรกคือระบบไหน (ตัดระบบ/ย้อนกลับ)
│   ├── add-student-notice.mjs  แปะป้ายช่วงเปลี่ยนผ่านบนหน้านักเรียน
│   ├── data/                   ผลลัพธ์จาก export (gitignored — มีชื่อนักเรียนจริง)
│   └── service-account.json    กุญแจ Firebase (gitignored — ห้ามขึ้น repo)
│
├── firebase.json  .firebaserc  ตั้งค่า Firebase CLI
└── package.json
```

**ทำไม `index.html` ยังอยู่ที่ root:** GitHub Pages เสิร์ฟ `index.html` ที่ root เป็นหน้าแรก
ย้ายเข้าโฟลเดอร์เมื่อไหร่เว็บที่ไลฟ์อยู่พังทันที
ระหว่างพัฒนาจึงเข้าระบบใหม่ที่ `/app.html` ควบคู่ไปกับของเดิมได้
ตอนตัดระบบค่อยสลับชื่อไฟล์

---

## เริ่มต้นใช้งาน

```bash
npm install
```

### 1. ดึงข้อมูลจากชีตเดิม
```bash
npm run export
```
ได้ `tools/data/Data.json` (303 แถว), `Users.json` (14), `WasteTypes.json` (2)

### 2. ตั้งรหัสผ่านครู
```bash
npm run set-passwords              # ดูว่าจะได้รหัสอะไรบ้าง ยังไม่เขียนอะไร
npm run set-passwords -- --apply   # สุ่มรหัสรายคนแล้วอัปเดตเข้า Firebase Auth
npm run handout                    # ใบแจ้งรหัสไว้พิมพ์แจก → docs/handout-passwords.html
```

รหัสถูกเขียนกลับลง `tools/accounts.json` (อยู่ใน .gitignore เพราะเป็นรหัสจริง)

> ⚠️ Firebase บังคับรหัสผ่านอย่างน้อย **6 ตัวอักษร** รหัส `1234` เดิมใช้ไม่ได้แล้ว
> **อย่าใช้รหัสเดียวกันทั้งโรงเรียน** — ครูจะเข้าบัญชีกันเองได้ แล้วประวัติผู้บันทึกจะเชื่อถือไม่ได้

### 3. ซ้อมก่อนเขียนจริง
```bash
node tools/seed-firestore.mjs --emulator --dry-run
```
ดูว่าจำนวนคน/ห้อง/บัญชีตรงกับที่ควรเป็นไหม โดยยังไม่เขียนอะไรลงไป

### 4. เขียนลงโปรเจกต์จริง
ต้องมี `tools/service-account.json` ก่อน
(Firebase Console → Project settings → Service accounts → Generate new private key)

```bash
npm run seed
npm run verify
```

### 4.1 ทดสอบว่ากฎกันจริง
```bash
npm run test:rules
```
ล็อกอินเป็นครูและแอดมินจริง ยิงคำสั่งที่ควรผ่านและควรถูกปฏิเสธรวม 38 ข้อ แล้วลบข้อมูลทดสอบให้เอง

ถ้ายอดคงเหลือเพี้ยน (เช่นมีคนลบธุรกรรมจาก Console ตรง ๆ):
```bash
node tools/recompute-balances.mjs --check   # ตรวจอย่างเดียว
node tools/recompute-balances.mjs           # แก้ให้ตรง
```

### 5. ติดตั้งกฎความปลอดภัยและดัชนี
```bash
npx firebase login
npm run deploy:rules
```

### 6. ทดสอบหน้าเว็บ
```bash
npm run serve      # แล้วเปิด http://localhost:5000/app.html
```

> ต้องเปิดผ่าน `http://` เท่านั้น เปิดไฟล์แบบ `file://` Firebase Auth จะไม่ทำงาน

---

## สิ่งที่ต้องตั้งค่าใน Firebase Console (ทำด้วยมือครั้งเดียว)

| ที่ | ต้องทำ | สถานะ |
|---|---|---|
| Authentication → Sign-in method | เปิด **Email/Password** | ✅ เปิดแล้ว |
| Authentication → Settings → Authorized domains | เพิ่มโดเมน GitHub Pages และ `localhost` | ✅ ใส่แล้ว |
| Firestore + Auth + Rules + Indexes | สร้างและ deploy | ✅ เสร็จแล้ว |
| Authentication → Sign-in method | ปิด Anonymous ที่ไม่ได้ใช้ | ✅ ปิดแล้ว |
| Google Cloud Console → APIs & Services → Credentials | จำกัด Browser API key ด้วย HTTP referrer | ⬜ ยังไม่ได้ทำ |

---

## บัญชีผู้ใช้

18 บัญชี — ครูประจำชั้น 15 คน + แอดมิน 3 คน (ดูตารางเต็มใน `tools/accounts.json`)

ล็อกอินด้วย **username เดิม** เช่น `Sb`, `Kn`, `ac` — ระบบเติม `@ecopink.local` ให้เอง
ครูเห็นและป้อนข้อมูลได้เฉพาะห้องตัวเอง แอดมินทำได้ทุกอย่างทุกห้อง

---

## ข้อควรรู้

- **โควต้าฟรี (Spark): อ่าน 50,000 / เขียน 20,000 ต่อวัน** ทุก query กรองด้วย `schoolYear` และห้องเสมอ
- **`student.html` ยังอ่านจากชีตเดิม** ระหว่างเปลี่ยนผ่าน แต้มและประวัตินักเรียนจะไม่ตรงกับที่ครูบันทึกในระบบใหม่
- **Firestore emulator ต้องใช้ Java** ถ้าไม่มีจะรัน `npm run emulators` ไม่ได้ (Auth emulator ไม่ต้องใช้)
- รายละเอียดกติกาการเขียนโค้ด โดยเฉพาะ **เรื่องวันที่** อยู่ใน [`CLAUDE.md`](CLAUDE.md) หัวข้อ 6
