# AtloGraph: Multi-Language Codebase Visualizer

**AtloGraph** คือเครื่องมือสำหรับนักพัฒนาที่ช่วยเปลี่ยน Source Code ที่ซับซ้อนให้กลายเป็นแผนภาพ (Interactive Graph) ที่สวยงาม เพื่อให้เข้าใจโครงสร้างสถาปัตยกรรมของโปรเจกต์ได้อย่างรวดเร็ว

---

## 1. เป้าหมายของโปรเจกต์ (Project Goal)
*   **สแกน Codebase แบบ Local:** รองรับหลายภาษา (C, C++, Rust, Go, TypeScript/JavaScript)
*   **สร้างแผนภาพความสัมพันธ์:** แสดงการเชื่อมโยงในระดับ Classes, Structs, Interfaces, Functions และ Imports/Includes
*   **Web-based UI:** นำเสนอผ่าน Interface ที่โต้ตอบได้ (Interactive) และเข้าใจง่าย
*   **ประโยชน์หลัก:** ช่วยให้นักพัฒนาเข้าใจ Legacy Code หรือโปรเจกต์ขนาดใหญ่ได้ทันที โดยไม่ต้องไล่อ่านโค้ดทีละไฟล์

---

## 2. สถาปัตยกรรมและเทคโนโลยี (Architecture & Tech Stack)
ระบบถูกออกแบบให้แยกส่วนกัน (Decoupled) โดยสื่อสารผ่าน **JSON Data Format**:

### A. Analyzer CLI (Backend)
ทำหน้าที่สแกนและวิเคราะห์โค้ดเบส
*   **Language:** Rust เน้นประสิทธิภาพการจัดการไฟล์แบบ Concurrent
*   **Core Engine:** [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) สำหรับการทำ Incremental Parsing ที่แม่นยำ
*   **Logic:** ใช้ Tree-sitter Query (`.scm`) เพื่อดึง Node สำคัญ เช่น `class_declaration`, `function_definition`
*   **Output:** สร้าง JSON กราฟที่มีโครงสร้างโหนด (`nodes`) และเส้นเชื่อมความสัมพันธ์ (`edges`)

### B. Visualization Frontend (Frontend)
ทำหน้าที่แสดงผลกราฟความสัมพันธ์ โดยเน้น **Aesthetic แบบ Obsidian Graph View**
*   **Framework:** React หรือ Svelte
*   **Graph Rendering Engine:**
    *   **D3.js (Force-Directed Graph):** หัวใจหลักในการสร้างฟิสิกส์ของกราฟ (แรงดึงดูด/แรงผลัก) แบบเดียวกับ Obsidian
    *   **Force-Graph / 2D-Force-Graph:** Library ที่ครอบ D3 เพื่อให้เขียนง่ายขึ้นและมี Performance สูง
    *   **Canvas/WebGL Rendering:** เพื่อรองรับโหนดจำนวนมาก (หลายพันโหนด) โดยที่ UI ยังลื่นไหล
*   **Key Features:** การ Highlight ความสัมพันธ์เมื่อ Hover, การซูมแบบลื่นไหล (Smooth Zooming), และการค้นหา/กรองแบบ Dynamic

---

## 3. ความท้าทายหลัก (Key Challenges)
1.  **ระดับความลึก (Granularity):** ควรดึงข้อมูลลึกแค่ไหน? (ระหว่างไฟล์/Import หรือลึกถึงระดับฟังก์ชันเรียกฟังก์ชันภายในไฟล์)
2.  **การแปลงรูปแบบ (Schema Mapping):** แต่ละภาษามีไวยากรณ์ต่างกัน (เช่น `struct` ใน Rust vs `class` ใน C++) จะทำให้เป็นมาตรฐานเดียวกันใน JSON ได้อย่างไร?
3.  **การรองรับขนาดใหญ่ (Scalability):** หากโปรเจกต์มีมากกว่า 10,000 โหนด จะทำอย่างไรไม่ให้ UI หน่วง? (เช่น ระบบ Filter, Scope หรือการทำ Lazy Loading)

---

## 4. เริ่มต้นการพัฒนา (Initial Step)
หากคุณต้องการเริ่มวางแผนการพัฒนา สามารถใช้คำสั่งนี้เพื่อพูดคุยต่อได้ทันที:

> "ช่วยเขียนแผนการพัฒนาขั้นเริ่มต้น (Initial Roadmap) ของโปรเจกต์ AtloGraph โดยเริ่มจากแนวทางการเขียน Tree-sitter query สั้นๆ เพื่อดึงฟังก์ชันจากโค้ดภาษา Rust