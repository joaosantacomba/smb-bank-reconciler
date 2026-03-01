# Roadmap: SMB Local Bank Movements Reconciler

## Phase 1: Data Acquisition & Preparation (MVP)
**Objective:** Handle file ingestion and metadata normalization.

- [x] Set up Angular project with Tailwind CSS.
- [x] **Task 1.1: Core Infrastructure & Parsing**
    - [x] Technical analysis and implementation plan approved.
    - [x] Install `xlsx` and `@types/xlsx`.
    - [x] Implement `ExcelParserService` (using `ArrayBuffer` and localization heuristic).
- [x] **Task 1.2: Intelligent Row & Column Identification**
    - [x] Logic to automatically identify "actual movement" rows vs. irrelevant rows.
    - [x] Automatic header detection and metadata flagging.
- [x] **Task 1.3: Upload & Mapping UI**
    - [x] Develop Drag & Drop UI.
    - [x] Create data preview table with row highlighting.
    - [x] Build controls for manual header setting and ignoring rows.
    - [x] Build controls for manual column mapping ('Date', 'Description', 'Amount').

## Phase 2: Core Matching & Persistence
**Objective:** Create the "Memory" of the system and allow manual/auto reconciliation.

- [x] **Task 2.1: Persistence Layer (The Brain)**
    - [x] Install `dexie` (IndexedDB) for robust local storage.
    - [x] Create `PersistenceService` to manage the "Rules Dictionary" (Description -> Entity/Category).
    - [x] Implement CRUD operations for local mapping memory.
- [x] **Task 2.2: Matching View & Historical Reconciliation**
    - [x] Matching View section appears in `AppComponent` once all column roles are mapped; shows only movement rows with Date, Description, Amount, Entity input, and Status badge.
    - [x] **Auto-Match on Load:** When all roles are mapped, `autoMatchRows()` queries `PersistenceService.findMatchingRule()` for every movement row using the mapped description columns. Matched rows are pre-filled.
    - [x] **Visual States:** `? unknown` (gray) / `✓ auto` (green) / `✎ manual` (blue) badges distinguish match sources.
    - [x] **Implicit Learning:** User types an entity and presses Enter or blurs the input → `onLabelCommit()` saves a new rule to IndexedDB immediately via `PersistenceService.addRule()`. Available in all future sessions.
- [ ] **Task 2.3: UX Shell & Global Navigation**
    - [x] Implement the 4-Tab navigation bar (Upload, Mapping, Memory, History).
    - [x] **Approval Gate:** Implement the "Approve Configuration" button to unlock subsequent tabs only after header/column validation.
    - [x] **UI Migration:** Refactor existing views to follow the `design-system.md` (cards, buttons, and neutral palette).
    - [x] **Empty States:** Implement centered empty state messages for all tabs.
- [ ] **Task 2.4: Persistence Management & Portability**
    - [ ] **Memory Tab:** Create CRUD interface for the Rules Dictionary (view/delete specific rules).
    - [ ] **Export/Import:** Implement JSON backup/restore for both Rules and History stores.
    - [ ] **Monthly History:** Implement the historical reporting view grouped by month.

## Phase 3: Advanced Matching & Usability
- [ ] Advanced fuzzy matching (Levenshtein distance).
- [ ] Bulk actions (Apply rule to all similar rows).
- [ ] Final Export of reconciled data to CSV/Excel.

## Phase 4: Automation & Integrations
- [ ] Local Machine Learning for smarter categorization suggestions.
- [ ] Offline capabilities (PWA setup).