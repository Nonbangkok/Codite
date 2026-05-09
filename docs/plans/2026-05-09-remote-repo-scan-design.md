# Design Document: Remote Repository Visualization

## Goal
Allow users to visualize any public Git repository by simply pasting its URL into the Codite UI. The system will handle cloning, scanning, and updating the graph locally.

## Architecture: Integrated Hybrid
We will use an integrated Node.js/Express server running alongside the Vite dev server to handle filesystem and process operations that cannot be done in the browser.

### Components
1.  **Frontend (React/Vite)**:
    *   `RemoteScanner`: A UI component for URL input and status display.
    *   `useGraphData`: Updated to allow manual refreshing of data.
2.  **Backend Bridge (Express)**:
    *   A small server (running via `concurrently` with Vite).
    *   Endpoint: `POST /api/scan` { url: string }.
3.  **Analyzer (Rust)**:
    *   The existing binary will be invoked by the Backend Bridge.

## Data Flow
1.  **Input**: User enters a Git URL in the `RemoteScanner`.
2.  **Request**: UI calls `POST /api/scan`.
3.  **Processing**:
    *   Backend creates `./temp_scan/`.
    *   Backend executes `git clone --depth 1 <url> ./temp_scan/`.
    *   Backend executes `./analyzer/target/release/analyzer ./temp_scan/`.
    *   Backend deletes `./temp_scan/`.
4.  **Response**: Backend returns status 200.
5.  **Refresh**: UI fetches the updated `data.json` and redraws the graph.

## Design Details

### UI/UX
*   **Placement**: Fixed at the top-center of the screen.
*   **Aesthetics**: Glassmorphism (blur, semi-transparent dark background).
*   **Feedback**: Animated spinner and status text (Cloning... Analyzing...).

### Error Handling
*   Input validation for Git URLs.
*   Try/Catch blocks around `exec` calls.
*   Ensuring `temp_scan/` is deleted even if the analysis fails.

## Implementation Steps
1.  **Infrastructure**:
    *   Install `express`, `cors`, `concurrently`.
    *   Create `ui/server.ts`.
2.  **Backend**:
    *   Implement `/api/scan` logic.
    *   Integrate `git clone` and binary execution.
3.  **Frontend**:
    *   Create `RemoteScanner` component.
    *   Add API call logic.
4.  **Integration**:
    *   Update `package.json` scripts to run both Vite and Express.
