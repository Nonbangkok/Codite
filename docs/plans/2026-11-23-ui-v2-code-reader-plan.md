# Codite UI v2: Code Reader & Explorer Upgrade Plan

**เป้าหมาย:** ทำให้การอ่านโค้ดยาว ๆ ใน Codite สบายเท่ากับอ่านใน editor และเพิ่มเครื่องมือสำรวจ codebase ให้ทำได้มากกว่าการดู graph

**Pain point หลัก (จากผู้ใช้):** โค้ดยาวมาก ๆ อ่านยาก

---

## 1. สิ่งที่เห็นจาก screenshot และข้อมูลจริง

ข้อมูลจาก `data.json` ของ Codite เอง:

| Node | บรรทัด | ระดับการเยื้องสูงสุด |
| --- | --- | --- |
| `GraphView.tsx::fn::GraphView` | 643 | 18 spaces |
| `typescript.rs::fn::parse` | 223 | 36 spaces (9 ชั้น) |
| `rust.rs::fn::parse` | 180 | 40 spaces (10 ชั้น) |

ปัญหาที่ทำให้อ่านยาก:

1. **บรรทัดที่ wrap หลุดการเยื้อง:** บรรทัด 91, 95, 99 ใน screenshot ต่อบรรทัดใหม่ที่คอลัมน์ 0 ทำให้โครงสร้าง `if`/`match` ที่ซ้อนกันอ่านไม่ออก
2. **การเยื้องลึกกินพื้นที่:** โค้ด Rust เยื้อง 10 ชั้น x 4 spaces = 40 ตัวอักษรเปล่า ๆ ใน panel ที่กว้างไม่ถึง 800px
3. **ไม่มีเครื่องมือนำทางในโค้ด:** ไม่มี folding, ค้นหาในโค้ด, outline, sticky scope หรือ indent guide ทำให้หลงว่าอยู่ใน block ไหน
4. **Panel แคบและแบ่งพื้นที่ไม่ได้:** Header, Connections และ Source อยู่ใน scroll เดียวกัน พอเลื่อนดูโค้ด ส่วน Connections ก็หายไป และขยายเป็นเต็มจอไม่ได้
5. **โค้ดทั้งไฟล์ render ทีเดียว:** ไฟล์ 740 บรรทัดสร้าง DOM ทุกบรรทัดพร้อม Prism ทั้งหมด จะช้าเมื่อเจอไฟล์ระดับหลายพันบรรทัด
6. **บั๊กที่เห็น:** ทั้งแอปเลื่อนไปทางซ้ายประมาณ 14px (โลโก้และคำว่า "Showing" ถูกตัด) สันนิษฐานว่า `focus()` หรือ `scrollIntoView()` เลื่อน container ที่เป็น `overflow: hidden` ได้ แก้ด้วย `overflow: clip`

---

## 2. หลักการออกแบบ

- **โค้ดคือพระเอกเมื่อเลือก node:** graph ช่วยหาว่าจะอ่านอะไร แต่เมื่อเลือกแล้วต้องอ่านได้สบายเหมือนใน editor
- **ไม่ทำ editor เอง:** ใช้ CodeMirror 6 แบบ read-only แทน Prism ที่ render เอง เพราะได้ virtualization, folding, search, line wrapping และ gutter มาครบ และ bundle ไม่ใหญ่ขึ้นมาก เมื่อเทียบกับ react-syntax-highlighter ที่จะถอดออก
- **ทุก feature ใช้ keyboard ได้** และมี test (Vitest + Playwright + axe) เหมือนรอบที่แล้ว

---

## 3. Phase 1: Code Reader (แก้ pain point โดยตรง)

ขนาดงาน: ใหญ่ (L) | ไม่ต้องแก้ analyzer

### 3.1 เปลี่ยน engine เป็น CodeMirror 6 แบบ read-only
- Package: `@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@codemirror/search` และ language packs: `lang-javascript` (TS/JS/TSX), `lang-rust`, `lang-python`, `lang-cpp` (C/C++), `lang-go`
- Render เฉพาะบรรทัดที่มองเห็น ไฟล์ 10,000 บรรทัดก็ยังลื่น
- ใช้ `firstLineNumber` ให้เลขบรรทัดตรงกับไฟล์จริง (ที่ตอนนี้คำนวณจาก `symbolStartLine`)
- ธีม dark/light ผูกกับ CSS tokens เดิม และสีต้องผ่าน contrast AA

### 3.2 การอ่านบรรทัดยาว
- **Wrap แบบรักษาการเยื้อง:** บรรทัดที่ต่อจะเยื้องเท่ากับบรรทัดต้นทาง + 2 ตัวอักษร (extension เล็ก ๆ คำนวณ hanging indent ต่อบรรทัด)
- **สลับ Wrap / Scroll แนวนอนได้** (`W`) และจำค่าไว้
- **Compact indentation:** แสดงการเยื้องเป็น 2 ช่องต่อชั้นแทน 4 โดยไม่แก้โค้ด เปิด/ปิดได้ (ช่วยโค้ด Rust ที่ซ้อน 10 ชั้นได้มาก)
- **Indent guides:** เส้นแนวตั้งบอกแต่ละชั้น และไฮไลต์ชั้นที่ cursor อยู่

### 3.3 นำทางในโค้ด
- **Code folding:** ลูกศรพับ block ใน gutter, `Fold all` / `Unfold all` และ "พับทุกอย่างที่ลึกเกิน N ชั้น" เพื่อดูโครงฟังก์ชันใหญ่ ๆ ทั้งก้อน
- **Sticky scope:** แถบด้านบนแสดงบรรทัดหัว block ที่กำลังอ่านอยู่ เช่น `match capture_name {` > `if let Some(parent)` (เหมือน Sticky Scroll ของ VS Code)
- **ค้นหาในโค้ด** (`Cmd+F` ภายใน panel) มีจำนวนผลลัพธ์ ปุ่มถัดไป/ก่อนหน้า และไฮไลต์ทุกจุด
- **Outline:** ถ้าเปิดไฟล์ จะแสดงรายการ symbol ในไฟล์ (จาก `contains` links + เลขบรรทัด) คลิกแล้วกระโดดไปบรรทัดนั้น ถ้าเปิด symbol จะแสดง breadcrumb `ไฟล์ > symbol`
- **ไปยังบรรทัด** (`Cmd+G` / `L`) และ URL ที่ชี้บรรทัดได้ เช่น `?node=…&L=76-120`

### 3.4 พื้นที่อ่านโค้ด
- **3 ขนาดของ panel:** ปกติ, กว้าง (แบ่งครึ่งจอกับ graph) และโหมดอ่านเต็มจอ (`E` เพื่อสลับ) จำค่าที่เลือกไว้
- **แยก panel เป็นแท็บ:** `Code` | `Connections` | `Details` โดย header (ชื่อ, path, ปุ่ม) ติดอยู่ด้านบนเสมอ พอเลื่อนดูโค้ดยาว ๆ จะไม่เสีย Connections ไป
- **ปรับขนาดตัวอักษร** (`Cmd+=` / `Cmd+-` ภายใน panel) และความสูงบรรทัด
- **Code minimap:** แถบภาพรวมไฟล์ด้านขวา มีเครื่องหมายตำแหน่ง symbol และผลค้นหา

### 3.5 ข้อมูลช่วยตัดสินใจก่อนอ่าน
- **Metrics ที่หัวโค้ด:** จำนวนบรรทัด, ความลึกสูงสุด และความซับซ้อนโดยประมาณ (นับ `if/match/for/while/&&/||`) พร้อมป้ายเตือนเมื่อฟังก์ชันยาวหรือซ้อนลึกผิดปกติ
- **Identifier ที่คลิกได้:** คำที่ตรงกับชื่อ symbol ใน graph จะขีดเส้นใต้ hover แล้วเห็น preview คลิกแล้วไป node นั้น (go-to-definition แบบง่ายจากชื่อ)

### เกณฑ์ว่าเสร็จ
- ไฟล์ 5,000 บรรทัดเปิดได้ภายใน 300ms และเลื่อนได้ราว 60fps (วัดด้วย Playwright แบบเดียวกับ perf test เดิม)
- บรรทัดที่ wrap ต้องเริ่มที่ระดับการเยื้องของบรรทัดต้นทาง (มี regression test)
- Fold, search, sticky scope, outline และ go-to-line มี e2e test ครบ และผ่าน axe ทั้งสองธีม
- แก้บั๊กแอปเลื่อนซ้ายพร้อม test

---

## 4. Phase 2: นำทางและพื้นที่ทำงาน

ขนาดงาน: กลาง (M)

- **Back / Forward** (`Alt+←` / `Alt+→`) ย้อนดู node ที่เคยเปิด และรายการ "เพิ่งเปิด"
- **แท็บหลาย node:** เปิดหลายไฟล์/symbol พร้อมกัน ปักหมุดแท็บได้
- **เปรียบเทียบสองฝั่ง (Split view):** เปิดสอง node คู่กัน เช่น ตัวเรียกกับตัวถูกเรียก
- **Bookmarks และโน้ตต่อ node:** เก็บใน localStorage พร้อม export/import เป็น JSON
- **Command palette แบบมีคำสั่ง:** พิมพ์ `>` เพื่อสั่งงาน เช่น "Toggle theme", "Export SVG", "Fold all" นอกเหนือจากค้นหา node
- **ค้นหาข้อความในโค้ดทั้งโปรเจกต์ (full-text):** ผลลัพธ์แสดงบรรทัดที่ตรงพร้อมบริบท คลิกแล้วเปิดที่บรรทัดนั้น ทำ index ใน Web Worker ไม่ให้ UI ค้าง
- **Sidebar ปรับขนาดและพับเก็บได้** (`B`) ให้พื้นที่โค้ดกว้างขึ้น

---

## 5. Phase 3: Graph ที่ทำได้มากขึ้น

ขนาดงาน: กลางถึงใหญ่ (M-L)

- **Layout หลายแบบ:** Force (ปัจจุบัน), Hierarchy (ต้นไม้ตามโฟลเดอร์/การ import), Radial รอบ node ที่เลือก
- **จัดกลุ่มตามโฟลเดอร์:** วาดขอบเขตกลุ่ม (convex hull) สีตามโฟลเดอร์ และยุบโฟลเดอร์เป็น node เดียว ดับเบิลคลิกเพื่อขยาย
- **ขนาด/สีตาม metric:** เลือกได้ว่า node ใหญ่ตามจำนวนบรรทัด, จำนวน connection หรือความซับซ้อน และโหมด heatmap
- **กรองเส้นตามชนิด:** เปิด/ปิด `contains`, `imports`, `implements` แยกกัน
- **ไฮไลต์ผลค้นหาใน graph:** พิมพ์แล้ว node ที่ไม่ตรงจะจางลงทันที
- **เลือกหลาย node (lasso / Shift+click):** แล้ว Focus, Export หรือหา path ระหว่างกลุ่ม
- **ปักตำแหน่ง node และบันทึก layout:** ลากแล้วค้างไว้ จำ layout ต่อ repo
- **Impact analysis:** "ใครพึ่งพา node นี้บ้าง" แบบย้อนกลับหลายชั้น พร้อมจำนวนไฟล์ที่ได้รับผลกระทบ

---

## 6. Phase 4: Insights ระดับโปรเจกต์

ขนาดงาน: กลาง (M)

- **หน้า Overview:** สถิติภาษา, จำนวนไฟล์และ symbol, ไฟล์/ฟังก์ชันที่ยาวที่สุด และไฟล์ที่ถูกพึ่งพามากที่สุด คลิกแล้วกระโดดไปที่ node
- **Health checks:** วงจร import (cycle), ไฟล์ที่ไม่มีใครใช้ (orphan), ฟังก์ชันยาวหรือซ้อนลึกเกินเกณฑ์
- **Export รายงาน** เป็น Markdown หรือ JSON

---

## 7. Phase 5: งานฝั่ง analyzer ที่บาง feature ต้องใช้

ขนาดงาน: ใหญ่ (L) | ทำคู่กับ Phase 1 ของแผนเดิมได้

| ต้องการ | ใช้กับ | ทำฝั่ง UI ชั่วคราวได้ไหม |
| --- | --- | --- |
| `start_line` / `end_line` ต่อ node | Outline, go-to-line, metrics | ได้ (คำนวณจาก code + offset) แต่ช้ากว่าและไม่แม่นทุกกรณี |
| Call edges (ใครเรียกใคร) | Identifier คลิกได้, impact analysis | ไม่ได้ ต้องใช้ tree-sitter |
| แยก `code` ออกจาก graph JSON และโหลดเมื่อเปิดดู | ไฟล์ใหญ่, repo ใหญ่ | ไม่ได้ ต้องแก้ server |
| Field `kind` แยกจาก `group` | Legend, filter | ทำอยู่แล้วด้วยการเดา |
| ข้าม `dist-server/` และเคารพ `.gitignore` | ข้อมูลไม่ซ้ำ | ไม่ได้ |

---

## 8. ลำดับที่แนะนำ

1. **Phase 1 (Code Reader)** ก่อน เพราะแก้ pain point ตรง ๆ และไม่ต้องรอ analyzer
2. **Phase 2** ต่อทันที เพราะใช้ฐานจาก Phase 1 (panel แบบแท็บ, URL บรรทัด)
3. **Phase 5** ส่วน `start_line`/`end_line` และแยก `code` ออกจาก JSON ทำคู่ไปได้
4. **Phase 3 และ 4** หลังจาก analyzer มี line range และ call edges แล้ว

## 9. ความเสี่ยง

- **CodeMirror 6 + React:** ต้องจัดการ lifecycle ให้ไม่สร้าง editor ใหม่ทุกครั้งที่เปลี่ยน node (ใช้ `EditorState` ใหม่บน view เดิม)
- **Bundle size:** CodeMirror + 5 language packs ประมาณ 250-350 kB (ก่อน gzip) แต่ถอด react-syntax-highlighter ออกได้ และ lazy-load language pack ตามภาษาที่เปิด
- **Sticky scope** ไม่มีใน CodeMirror ต้องเขียน extension เอง (ใช้ syntax tree หา block ที่ครอบอยู่)
- **ข้อมูล code ซ้ำ:** ตอนนี้ไฟล์กับ symbol ทุกตัวเก็บ code ซ้ำกัน repo ใหญ่จะทำให้ JSON บวม จึงควรทำ Phase 5 ข้อแยก code ไม่ช้าเกินไป
