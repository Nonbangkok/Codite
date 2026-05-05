# AtloGraph: แผนการเตรียมตัวก่อนเริ่มพัฒนา (Pre-Development Planning)

เอกสารฉบับนี้รวบรวมสิ่งที่ต้องตัดสินใจและวางแผนก่อนเริ่มเขียนโค้ด เพื่อให้การพัฒนา AtloGraph เป็นไปอย่างราบรื่นและมีโครงสร้างที่ชัดเจน

---

## 1. การกำหนดขอบเขต MVP (MVP Scope Definition)
เราควรเริ่มจากสิ่งที่เล็กที่สุดแต่ใช้งานได้จริง (Minimum Viable Product):
*   **ภาษาเริ่มต้น:** เลือก 1 ภาษาก่อน (แนะนำ **Rust** เพราะ Backend เราใช้ Rust จะได้ทดสอบได้ง่าย)
*   **ระดับการวิเคราะห์:** เริ่มที่ระดับ **File & Function** (ไฟล์ไหนเรียกฟังก์ชันอะไร)
*   **การแสดงผล:** กราฟแบบ 2 มิติที่ขยับและจัดกลุ่มตามไฟล์ได้

---

## 2. การตัดสินใจเชิงเทคนิค (Technical Decisions)

### A. Backend (Rust + Tree-sitter)
*   **Crate Selection:** ต้องเลือกใช้ `tree-sitter` และ `tree-sitter-rust` (หรือภาษาที่เลือก)
*   **Query Strategy:** ออกแบบโครงสร้าง `.scm` (S-expressions) สำหรับดึงข้อมูลเบื้องต้น:
    *   ฟังก์ชัน (name, start_line, end_line)
    *   การเรียกใช้ (caller -> callee)
*   **Performance:** วางแผนการใช้ `Rayon` หรือ `Tokio` สำหรับการสแกนไฟล์แบบขนาน (Parallel Scanning)

### B. Visualization Frontend (Obsidian-Style Graph)
*   **Engine Choice:** ใช้ `force-graph` (หรือ `react-force-graph`) ซึ่งทำงานบนพื้นฐานของ **D3-force**
    *   **เหตุผล:** ให้ฟิสิกส์ที่สมจริง มีแรงหน่วง (damping) และแรงดึงดูด (charge) แบบเดียวกับ Obsidian
*   **Rendering Context:** เลือกใช้ **Canvas (2D)** สำหรับ MVP เพื่อให้รองรับ Node จำนวนหลักพันได้ลื่นไหล
*   **Interaction Strategy:**
    *   **Focus Mode:** เมื่อคลิกที่ Node เส้นเชื่อมอื่นจะจางลง (Fade out)
    *   **Physics Simulation:** กราฟจะค่อยๆ จัดระเบียบตัวเอง (Settle) เมื่อข้อมูลถูกโหลดเข้ามา

---

## 3. ออกแบบมาตรฐานข้อมูล (Data Schema Design)
ต้องระบุ JSON Schema ที่ใช้ส่งข้อมูลจาก CLI ไปยัง UI (รองรับการจัดกลุ่มตามโฟลเดอร์เพื่อเปลี่ยนสีโหนดแบบ Obsidian):

```json
{
  "nodes": [
    { 
      "id": "file-1", 
      "label": "main.rs", 
      "group": "src", 
      "val": 10 
    }
  ],
  "links": [
    { "source": "file-1", "target": "utils.rs", "type": "import" }
  ]
}
```

---

## 4. แผนการพัฒนา (Development Roadmap)

### ระยะที่ 0: พื้นฐานและงานวิจัย (1-2 สัปดาห์)
- [ ] ทดสอบ Tree-sitter query ดึงความสัมพันธ์ใน Rust
- [ ] ตั้งค่า Monorepo (Rust Backend + React/Svelte Frontend)
- [ ] ทดลองใช้ `react-force-graph` กับข้อมูล Dummy เพื่อจูนค่า Physics (Force Strength, Distance)

### ระยะที่ 1: โปรโตไทป์ CLI & Data Pipe (2-3 สัปดาห์)
- [ ] CLI สแกน Rust Code แล้ว Generate `graph.json`
- [ ] พัฒนาตัวเชื่อม (Watcher) ให้ UI อัปเดตอัตโนมัติเมื่อโค้ดเปลี่ยน (Live Preview)

### ระยะที่ 2: UI Polish & Obsidian Experience (2-3 สัปดาห์)
- [ ] เพิ่มระบบ **Color by Directory** (สีของโหนดเปลี่ยนตามโฟลเดอร์)
- [ ] พัฒนาการ Interaction (Hover highlight, Click to zoom)
- [ ] เพิ่มระบบ Search ชื่อฟังก์ชัน/ไฟล์ในกราฟ

---

## 5. รายการสิ่งที่ต้องทำทันที (Immediate Action Items)
1.  **ติดตั้ง Environment:** Rust (cargo), Node.js (npm/pnpm)
2.  **POC Logic:** เขียนโค้ด Rust สแกน Directory แล้วสร้าง List ของไฟล์ทั้งหมดในรูปแบบ JSON
3.  **POC UI:** สร้างโปรเจกต์ React/Svelte เปล่าๆ แล้วลอง Render `force-graph` ให้ขยับได้

---

> [!TIP]
> ความสวยงามของ Obsidian Graph ไม่ได้อยู่ที่ข้อมูลอย่างเดียว แต่อยู่ที่ **"ความรู้สึก" (Feel)** ของการขยับ เราควรใช้เวลาจูนค่า `charge` และ `linkDistance` ให้ดูเป็นธรรมชาติที่สุด
