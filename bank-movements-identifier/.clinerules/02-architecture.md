# Architecture: SMB Local Bank Movements Reconciler

## Core Principles
- **Client-Side Only:** All processing occurs in the user's browser.
- **Privacy by Design:** Zero data leaves the local machine.
- **Modularity:** Separation between parsing, matching, and persistent storage.

## Components
1. **UI Layer (Angular):** Tab-based interface styled with Tailwind CSS following the `design-system.md`.
2. **Persistence Layer (Dexie.js):** - **Rules Store:** Stores mapping rules (criteria per column index -> Entity).
    - **History Store:** Stores processed and approved bank movements grouped by month.
3. **Excel Parser (SheetJS):** Handles file ingestion and raw data extraction.
4. **Matching Engine:** Compares current file rows against the Rules Store for auto-categorization.

## UX & Interaction Patterns

### 1. The Multi-Step Workflow
- **Tab 1: Upload CSV (Configuration):**
    - File upload and automatic header detection.
    - **Manual Mapping:** User must select which columns correspond to 'Date', 'Description' (1 to 3 columns), and 'Amount'.
    - **Approval Gate:** User must click an "Approve Configuration" button to unlock subsequent tabs.
- **Tab 2: Customer Mapping (Execution):**
    - Displays only the columns selected in the configuration step.
    - **Visual Indicators:** Auto-matched rows are tagged  "Auto").
    - **Interaction:** Users can override matches or manually assign entities.
- **Tab 3: Rules Management (Memory):**
    - CRUD interface for all saved matching rules.
    - Allows auditing, deleting, or manually adding rules.
    - **Portability:** Options to Export and Import the Rules database (JSON).
- **Tab 4: Monthly History (Reporting):**
    - View of all processed movements organized by month.
    - **Portability:** Options to Export and Import historical data (JSON).

### 2. Learning & Persistence Logic
- **Implicit Learning:** Assigning an Entity to a row immediately creates and persists a rule in Dexie.
- **Global Reactivity:** A new rule instantly triggers a re-scan of all "Unknown" rows in the current view.
- **Manual Data Management:** Users have full control over importing/exporting JSON backups to prevent data loss or migrate between browsers.

## Data Flow
1. **Ingestion:** CSV/Excel parsed into a raw 2D array.
2. **Approval:** User maps columns and approves the configuration.
3. **Enrichment:** System applies historical rules to the approved columns.
4. **Commit:** Approved movements are saved to the History Store.