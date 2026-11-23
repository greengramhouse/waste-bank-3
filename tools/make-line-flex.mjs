/**
 * สร้าง LINE Flex Message แจ้งชื่อผู้ใช้/รหัสผ่านรายคน จาก accounts.json
 *
 *   node tools/make-line-flex.mjs
 *   node tools/make-line-flex.mjs --url https://ที่อยู่จริง/
 *
 * ได้ไฟล์ docs/handout-line.html → เปิดในเบราว์เซอร์ กดปุ่มคัดลอก JSON ของครูทีละคน
 * มีสองแบบให้เลือกตามเครื่องมือที่ใช้ส่ง:
 *   - เฉพาะ bubble  → วางใน Flex Message Simulator หรือเครื่องมือที่ขอแค่ "contents"
 *   - ข้อความเต็ม   → { type:'flex', altText, contents } สำหรับยิงผ่าน Messaging API
 *
 * ไฟล์ผลลัพธ์มีรหัสผ่านจริง จึงอยู่ใน .gitignore (docs/handout*) เหมือนใบพิมพ์
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL as DEFAULT_SITE_URL, accountScopeText } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'docs', 'handout-line.html');

const URL_ARG = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const SITE_URL = URL_ARG || DEFAULT_SITE_URL;

const accounts = JSON.parse(await readFile(join(HERE, 'accounts.json'), 'utf8')).accounts || [];

const missing = accounts.filter(a => !a.password);
if (missing.length) {
  console.error(`✗ ยังไม่มีรหัสผ่านใน accounts.json ${missing.length} บัญชี: ${missing.map(a => a.username).join(', ')}`);
  console.error('  รัน `node tools/set-passwords.mjs --apply` ก่อน');
  process.exit(1);
}

// ---------------------------------------------------------------- Flex

const PINK = '#EC4899';
const PINK_DARK = '#BE185D';
const GRAY = '#6B7280';

/** แถว "หัวข้อ : ค่า" — ค่าตัวใหญ่สีเข้ม เพราะครูต้องอ่านแล้วพิมพ์ตามบนมือถือ */
function credRow(label, value) {
  return {
    type: 'box', layout: 'horizontal', alignItems: 'center',
    contents: [
      { type: 'text', text: label, size: 'sm', color: GRAY, flex: 3 },
      { type: 'text', text: value, size: 'xl', weight: 'bold', color: PINK_DARK, flex: 5, wrap: true },
    ],
  };
}

function note(text) {
  return { type: 'text', text, size: 'xs', color: '#9A3412', wrap: true };
}

function bubbleFor(acc) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: PINK, paddingAll: '16px',
      contents: [
        { type: 'text', text: '♻ ธนาคารขยะโรงเรียนชุมชนวัดไทยงาม', color: '#FFFFFF', weight: 'bold', size: 'sm' },
        { type: 'text', text: 'บัญชีเข้าใช้ระบบใหม่', color: '#FCE7F3', size: 'xs', margin: 'xs' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        { type: 'text', text: acc.name, size: 'lg', weight: 'bold', color: '#1F2937', wrap: true },
        { type: 'text', text: accountScopeText(acc), size: 'xs', color: GRAY, wrap: true },
        { type: 'separator', margin: 'md' },
        credRow('ชื่อผู้ใช้', acc.username),
        credRow('รหัสผ่าน', acc.password),
        {
          type: 'box', layout: 'vertical', spacing: 'xs', margin: 'lg',
          backgroundColor: '#FFF7ED', cornerRadius: '8px', paddingAll: '10px',
          contents: [
            note('• รหัสผ่านเป็นตัวพิมพ์เล็กทั้งหมด มีขีดกลาง'),
            note('• เข้าจากปุ่มด้านล่างเท่านั้น (ลงท้าย /app.html) หน้าเว็บเดิมใช้รหัสนี้ไม่ได้'),
            note('• อย่าส่งต่อข้อความนี้ และอย่าให้นักเรียนเห็น'),
          ],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
      contents: [
        // clipboard action — กดแล้วรหัสเข้าคลิปบอร์ด ไปวางในช่องรหัสผ่านได้เลย ไม่ต้องพิมพ์ตาม
        // ต้องใช้ LINE 14.0 ขึ้นไป เครื่องที่เก่ากว่าปุ่มจะกดไม่ได้ แต่รหัสยังอ่านจากการ์ดได้ตามเดิม
        { type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'clipboard', label: 'คัดลอกรหัสผ่าน', clipboardText: acc.password } },
        { type: 'button', style: 'primary', color: PINK, height: 'sm',
          action: { type: 'uri', label: 'เปิดระบบธนาคารขยะ', uri: SITE_URL } },
      ],
    },
  };
}

/**
 * altText คือข้อความที่โผล่ในการแจ้งเตือนและหน้ารายการแชต
 * จงใจไม่ใส่รหัสผ่าน — คนข้างตัวครูเห็นหน้าจอล็อกได้
 */
function messageFor(acc) {
  return { type: 'flex', altText: `บัญชีผู้ใช้ EcoPink ของ${acc.name}`, contents: bubbleFor(acc) };
}

// ---------------------------------------------------------------- หน้า HTML สำหรับคัดลอก

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cards = accounts.map((a, i) => `
    <section class="card">
      <div class="who">
        <div>
          <div class="name">${esc(a.name)}</div>
          <div class="scope">${esc(accountScopeText(a))} · <code>${esc(a.username)}</code></div>
        </div>
        <div class="btns">
          <button type="button" data-copy="bubble-${i}">คัดลอก bubble</button>
          <button type="button" data-copy="msg-${i}" class="alt">คัดลอกข้อความเต็ม</button>
        </div>
      </div>
      <details>
        <summary>ดู JSON</summary>
        <textarea id="bubble-${i}" readonly aria-label="Flex bubble ของ ${esc(a.name)}">${esc(JSON.stringify(bubbleFor(a), null, 2))}</textarea>
        <textarea id="msg-${i}" readonly hidden aria-label="Flex message ของ ${esc(a.name)}">${esc(JSON.stringify(messageFor(a), null, 2))}</textarea>
      </details>
    </section>`).join('');

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINE Flex แจ้งรหัส EcoPink</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', sans-serif; margin: 0; padding: 16px; background: #fdf2f8; color: #1f2937; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; color: #be185d; margin: 0 0 12px; }
  .note { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 12px 14px; font-size: 14px; line-height: 1.7; margin-bottom: 16px; }
  .note b { color: #9a3412; }
  .card { background: #fff; border: 1px solid #fbcfe8; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .who { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
  .name { font-weight: 700; font-size: 16px; }
  .scope { font-size: 13px; color: #6b7280; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; font-size: 14px; min-height: 44px; padding: 0 14px; border-radius: 8px; border: 0; background: #ec4899; color: #fff; cursor: pointer; }
  button.alt { background: #fff; color: #be185d; border: 1px solid #f9a8d4; }
  button.done { background: #16a34a; color: #fff; border-color: #16a34a; }
  details { margin-top: 8px; font-size: 13px; }
  summary { cursor: pointer; color: #6b7280; }
  textarea { width: 100%; height: 220px; margin-top: 6px; font: 12px/1.4 ui-monospace, Consolas, monospace; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }
  code { background: #fce7f3; padding: 0 4px; border-radius: 3px; }
</style>
</head>
<body>
<main>
  <h1>LINE Flex Message แจ้งบัญชีครู (${accounts.length} คน)</h1>
  <div class="note">
    <b>คัดลอก bubble</b> → วางใน <a href="https://developers.line.biz/flex-simulator/" target="_blank" rel="noopener">Flex Message Simulator</a>
    หรือเครื่องมือที่ขอแค่ส่วน <code>contents</code><br>
    <b>คัดลอกข้อความเต็ม</b> → <code>{ type: "flex", altText, contents }</code> สำหรับส่งผ่าน Messaging API
    (altText ไม่มีรหัสผ่าน เพราะโผล่ในการแจ้งเตือนบนหน้าจอล็อก)<br>
    <b>ข้อควรระวัง:</b> ไฟล์นี้มีรหัสผ่านจริงทุกคน ส่งครบแล้วลบทิ้งได้ — สร้างใหม่ได้ด้วย <code>npm run handout:line</code><br>
    <b>ลิงก์บนปุ่มในข้อความ:</b> <code>${esc(SITE_URL)}</code>
  </div>
${cards}
</main>
<script>
  // file:// บางเบราว์เซอร์ไม่ให้ใช้ navigator.clipboard จึงมีทางสำรองด้วย execCommand
  async function copyText(text, ta) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    ta.hidden = false; ta.select();
    const ok = document.execCommand('copy');
    if (ta.id.startsWith('msg-')) ta.hidden = true;
    return ok;
  }
  document.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-copy]');
    if (!btn) return;
    const ta = document.getElementById(btn.dataset.copy);
    const label = btn.textContent;
    const ok = await copyText(ta.value, ta);
    btn.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่ได้ — เปิด "ดู JSON" แล้วคัดลอกเอง';
    btn.classList.toggle('done', ok);
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 2000);
  });
</script>
</body>
</html>
`;

await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(OUT, html, 'utf8');

console.log(`✓ สร้าง ${OUT}`);
console.log(`  ${accounts.length} ข้อความ · ลิงก์บนปุ่ม: ${SITE_URL}`);
console.log('  เปิดไฟล์ในเบราว์เซอร์ แล้วกดคัดลอกทีละคน');
