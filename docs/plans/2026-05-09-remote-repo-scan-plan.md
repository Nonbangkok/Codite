# Remote Repository Visualization Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Enable users to visualize remote Git repositories via the UI by pasting a URL.

**Architecture:** A hybrid Node.js/Express server acting as a bridge to execute local Git and Rust commands on behalf of the browser UI.

**Tech Stack:** React, Express, Node.js `child_process`, `git clone`.

---

### Task 1: Setup Backend Infrastructure

**Files:**
- Modify: `ui/package.json`
- Create: `ui/server.ts`

**Step 1: Install dependencies**
Run: `npm install express cors concurrently tsx @types/express @types/cors --save-dev`
Expected: `package.json` updated.

**Step 2: Create basic server structure**
Write minimal Express server in `ui/server.ts` with a health check.

**Step 3: Commit setup**
```bash
git add ui/package.json ui/server.ts
git commit -m "chore: setup backend infrastructure for remote scanning"
```

---

### Task 2: Implement Scan API

**Files:**
- Modify: `ui/server.ts`

**Step 1: Implement POST /api/scan**
Add logic to:
1. Create `./cloned_temp` directory.
2. Run `git clone --depth 1 <url> ./cloned_temp/<id>`.
3. Run `../analyzer/target/release/analyzer ./cloned_temp/<id>`.
4. Cleanup `./cloned_temp`.

**Step 2: Test API manually**
Run: `npx tsx ui/server.ts` in one terminal and `curl -X POST http://localhost:3001/api/scan -H "Content-Type: application/json" -d '{"url":"https://github.com/user/repo"}'` in another.
Expected: Success response and updated `data.json`.

**Step 3: Commit API**
```bash
git add ui/server.ts
git commit -m "feat: implement remote scan API endpoint"
```

---

### Task 3: Create RemoteScanner UI Component

**Files:**
- Create: `ui/src/components/RemoteScanner.tsx`

**Step 1: Design the component**
Implement a glassmorphism input bar with status indicators.

**Step 2: Add API call logic**
Use `fetch` to call `/api/scan` and handle loading/error states.

**Step 3: Commit UI component**
```bash
git add ui/src/components/RemoteScanner.tsx
git commit -m "feat: add RemoteScanner UI component"
```

---

### Task 4: Integrate with App.tsx

**Files:**
- Modify: `ui/src/App.tsx`

**Step 1: Place RemoteScanner in layout**
Insert the component at the top of the main graph area.

**Step 2: Trigger graph refresh**
Update `graphData` fetching logic to be callable after a successful scan.

**Step 3: Commit integration**
```bash
git add ui/src/App.tsx
git commit -m "feat: integrate remote scanning into main application"
```

---

### Task 5: Final Automation

**Files:**
- Modify: `ui/package.json`

**Step 1: Update dev script**
Use `concurrently` to run both Vite and the Express server.
`"dev": "concurrently \"vite\" \"tsx server.ts\""`

**Step 2: Final verification**
Run `npm run dev` and test the full flow in the browser.

**Step 3: Commit automation**
```bash
git add ui/package.json
git commit -m "chore: automate UI and API startup"
```
