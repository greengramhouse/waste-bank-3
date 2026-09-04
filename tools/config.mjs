/**
 * ค่าคงที่และตัวช่วยที่ใช้ร่วมกันทุกสคริปต์ใน tools/
 * ตรรกะวันที่ในไฟล์นี้ต้องตรงกับที่ใช้ในหน้าเว็บเสมอ (ดู CLAUDE.md หัวข้อ 6)
 */

export const SHEET_ID = '1NTrt_HI8c0syDO6ZLjKBKVQUVldxGpXVn_haRB9TYss';
export const PROJECT_ID = 'ecopink';

/** โดเมนอีเมลสังเคราะห์ — ไม่ต้องมีอยู่จริง ใช้เป็นแค่ตัวระบุตัวตนใน Firebase Auth */
export const EMAIL_DOMAIN = 'ecopink.local';

export const TZ = 'Asia/Bangkok';

/** ห้องที่บุคลากรสังกัด — ไม่ใช่ห้องเรียนจริง จึงไม่มีใน ROOM_ORDER */
export const STAFF_ROOM = 'ส่วนกลาง';
export const STAFF_ROOM_ORDER = 99;

/**
 * ลำดับห้องสำหรับเรียง — localeCompare เรียงภาษาไทยผิด ("อ.2" ไปอยู่ท้ายสุด)
 * จึงต้องกำหนดลำดับเองแล้วเก็บเป็นตัวเลขไว้ในเอกสาร
 */
export const ROOM_ORDER = {
  'อ.2': 1,
  'อ.3': 2,
  'ป.1': 3,
  'ป.2': 4,
  'ป.3': 5,
  'ป.4': 6,
  'ป.5': 7,
  'ป.6': 8,
  'ม.1': 9,
  'ม.2': 10,
  'ม.3': 11,
};

/** วันนี้ตามเวลาไทย รูปแบบ 'YYYY-MM-DD' — ถูกต้องแม้เครื่องตั้งโซนเวลาผิด */
export function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/**
 * ปีการศึกษาไทย (พ.ศ.) ของวันที่หนึ่ง ๆ — เปิดเทอมกลางพฤษภาคม
 * ม.ค.–เม.ย. ยังนับเป็นปีการศึกษาก่อนหน้า
 *   '2026-09-04' → '2569'   (พ.ค. 2026 – มี.ค. 2027 คือปีการศึกษา 2569)
 *   '2027-02-10' → '2569'
 */
export function schoolYearOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return String(m >= 5 ? y + 543 : y + 542);
}

/** ปีการศึกษาปัจจุบัน — สคริปต์ทุกตัวใช้ค่านี้เป็นค่าเริ่มต้น */
export const SCHOOL_YEAR = schoolYearOf(todayBangkok());

/**
 * ทำความสะอาดชื่อคนจากชีต
 * ข้อมูลเดิมสะกดไม่นิ่ง — มีช่องว่างซ้อน ("ครูเสฏฐวุฒิ  นิลกระ") และช่องว่างท้ายชื่อ
 * ทำครั้งเดียวตอนย้าย จะได้ไม่ต้องมาเดาชื่อตอนรันอีก
 */
export function cleanName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** ตัดคำนำหน้า "ครู" ออก ใช้ตอนเทียบชื่อจากชีตสองแหล่ง */
export function stripTeacherPrefix(s) {
  return cleanName(s).replace(/^ครู\s*/, '');
}

/** username → อีเมลสังเคราะห์ (ตัวพิมพ์เล็กเสมอ เพราะ Firebase Auth ไม่สนตัวพิมพ์แต่เราสนความสม่ำเสมอ) */
export function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

/** แถวในชีต Data ที่คอลัมน์ "ครูที่ปรึกษา" เขียนว่า "ครู" คือแถวบุคลากร ไม่ใช่นักเรียน */
export function isStaffRow(row) {
  return cleanName(row['ครูที่ปรึกษา']) === 'ครู';
}
