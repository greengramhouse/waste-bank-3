# สถานะงาน EcoPink — บันทึก ณ 4 กันยายน 2569 (2026-09-04)

เอกสารส่งต่องาน อ่านไฟล์นี้ก่อนทำต่อ แล้วค่อยดู [`CLAUDE.md`](../CLAUDE.md) กับ [`plan.md`](./plan.md)

---

## ทำถึงไหนแล้ว

| เฟส | เนื้องาน | สถานะ |
|---|---|---|
| 0 | เตรียม Firebase (Firestore + Auth + authorized domains) | ✅ เสร็จ |
| 1 | สคริปต์ย้ายข้อมูล `tools/` | ✅ เสร็จ |
| 2 | Security Rules + composite indexes (deploy แล้ว) | ✅ เสร็จ |
| 3 | อะแดปเตอร์ Firestore ใน `app.html` | ✅ เสร็จ |
| 4 | ปรับ UI + รองรับมือถือ | ✅ เสร็จ |
| 5 | ทดสอบ | ✅ ผ่าน 38/38 + ไล่ทุกแท็บบนเบราว์เซอร์ |
| **6** | **Deploy ขึ้น GitHub Pages + ตัดระบบ** | ⬜ **ยังไม่เริ่ม — งานถัดไป** |

---

## ระบบพร้อมใช้แล้ว

**Firestore (โปรเจกต์ `ecopink`)** — ข้อมูลจริงอยู่ครบ
`members` 303 (นักเรียน 284 / บุคลากร 19) · `rooms` 11 · `wasteTypes` 2 · `balances` 303 (ยอด 0)
`transactions` 0 และ `deletedTransactions` 0 — **ฐานสะอาด ไม่มีข้อมูลทดสอบค้าง**

**Firebase Auth** — 18 บัญชี (ครู 15 + แอดมิน 3) พร้อม custom claims `role` / `rooms` / `canViewAll`
ล็อกอินด้วย username เดิม เช่น `Sn`, `Sb`, `ac` — รหัสเริ่มต้น `ecopink2569` ทุกคน

**`app.html`** — ระบบใหม่ทำงานครบทุกแท็บ ทดสอบบนเบราว์เซอร์จริงแล้ว

---

## เฟส 6 ต้องทำอะไรบ้าง

1. **จำกัด Browser API key ด้วย HTTP referrer** ใน [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials?project=ecopink)
   ตอนนี้ยังเปิดกว้าง — Rules กันข้อมูลได้ แต่กันคนเอา key ไปยิงจนโควต้าหมดไม่ได้
2. **Deploy `app.html` ขึ้น GitHub Pages** แล้วให้ครูทดลองใช้คู่ขนานกับของเดิมสัก 1–2 สัปดาห์
3. **แจ้งรหัสผ่านใหม่ให้ครูทุกคน** — รหัส `1234` เดิมใช้ไม่ได้แล้ว (Firebase บังคับ ≥ 6 ตัวอักษร)
   ครูห้องที่เคยใช้บัญชีร่วมกันตอนนี้แยกเป็นคนละบัญชี ดูตารางใน `tools/accounts.json`
4. **ปิดหรือแขวนป้าย `student.html`** — ยังชี้ Google Sheets เดิม พอครูเริ่มบันทึกใน Firestore
   นักเรียนจะไม่เห็นรายการใหม่และแต้มจะไม่ขยับ
5. **สลับชื่อไฟล์ตอนตัดระบบจริง** — `index.html` → `index-sheets.html.bak`, `app.html` → `index.html`
   (GitHub Pages เสิร์ฟ `index.html` ที่ root เป็นหน้าแรก)
6. **อย่าเพิ่งลบ deployment ของ Apps Script** เก็บไว้ย้อนกลับได้ 1–2 สัปดาห์แรก
   ตั้งชีต Google Sheets เป็น read-only ไว้เป็น backup

---

## ค้างไว้ให้ตรวจซ้ำ

- **หน้ารับฝากด่วนบนจอกว้าง ยังไม่ได้ดูด้วยตา** — โค้ดเป็น Tailwind มาตรฐาน (`sticky top-0` ใน `overflow-y-auto`)
  และผ่าน static check แล้ว แต่ระหว่างทดสอบ viewport ของ Chrome ติดโหมดจำลองมือถือค้าง
  ต้องปิดแท็บรีเซ็ต ทำให้ส่วนขยายหลุดการเชื่อมต่อก่อนได้ตรวจ
- UI ที่ยังไม่ได้ทำ ดู `CLAUDE.md` หัวข้อ 8.3 (ตารางรายงานบนมือถือ, keyboard nav ใน dropdown)

---

## เครื่องมือที่ใช้บ่อย

```bash
npm run serve        # เปิด http://localhost:5000/app.html
npm run test:rules   # ทดสอบสิทธิ์ 38 ข้อกับฐานจริง (ล้างข้อมูลทดสอบให้เอง)
npm run verify       # ตรวจความครบถ้วนของข้อมูล
npm run balances     # คำนวณยอดคงเหลือใหม่จากธุรกรรมจริง (ใส่ --check เพื่อดูเฉย ๆ)
npm run deploy:rules # ติดตั้ง Rules + indexes ใหม่หลังแก้
```

**ข้อควรระวังของเครื่องนี้**
- ไม่มี Java → Firestore emulator รันไม่ได้ ต้องทดสอบกับโปรเจกต์จริง (`npm run test:rules` ล้างข้อมูลให้เอง)
- Firebase CLI ล็อกอินไว้แล้วในชื่อ `wrat5590@gmail.com` — service account ที่ Firebase สร้างให้ deploy Rules ไม่ได้ (ไม่มีสิทธิ์) ต้องใช้บัญชีนี้
- `tools/service-account.json` วางไว้แล้วและอยู่ใน `.gitignore` — **อย่า commit**

---

## สิ่งที่ตัดสินใจไปแล้ว อย่ารื้อโดยไม่ถาม

- **บุคลากรสังกัดห้องที่ตัวเองเป็นครูประจำชั้น** ไม่ใช่ห้องลอย ๆ — ถ้าเปลี่ยนเป็น `"ส่วนกลาง"` ครูจะรับฝากขยะในชื่อตัวเองไม่ได้ เพราะ Rules มองว่าเขียนข้ามห้อง
- **`transactions.date` เป็น string `'YYYY-MM-DD'` ไม่ใช่ Timestamp** — เหตุผลเต็มอยู่ใน `CLAUDE.md` หัวข้อ 6
- **Firebase SDK ต้องเป็นรุ่น compat** — โค้ดใช้ `onclick=` ที่ต้องการฟังก์ชันใน global scope
- **เมนูมาจาก `TABS` + `NAV_GROUPS`** ห้ามเขียนปุ่มเมนูลง HTML ตรง ๆ
