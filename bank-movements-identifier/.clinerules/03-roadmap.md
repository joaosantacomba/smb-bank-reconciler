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

## Phase 3: Intelligent Matching & Pattern Recognition
**Objective:** Transition from static string matching to a dynamic pattern-recognition engine that learns "dialects" and preserves data integrity.

- [x] **Task 3.1: Description Anatomy & Tokenization**
    - [x] Implement a `MovementTokenizerService` to decompose bank strings into `Anchors` (static text) and `Variables` (dates, sequential IDs, timestamps).
    - [x] Ensure the process is non-destructive: the `originalDescription` must remain intact for future auditing/invoicing.
    - [x] Create a "Search Key" generator that extracts stable patterns to be used for matching lookups.

- [x] **Task 3.2: Rule Hierarchy & Canonical Entities**
    - [x] Refactor `PersistenceService` to support multiple "Dialects" (source patterns) pointing to a single "Canonical Entity" (e.g., different bank strings all mapping to entity "Continente").
    - [x] Implement rule scoping: allow patterns to be generic or specific to certain recurring structures.

- [x] **Task 3.3: Multi-Level Matching Pipeline**
    - [x] Implement the three-tier matching logic:
        - **Level 1 (Exact):** Direct match using the `originalDescription`.
        - **Level 2 (Structural):** Match based on `Anchors` and `SearchKey` (ignores dates/IDs).
        - **Level 3 (Similarity):** Levenshtein-based matching for normalized strings (0.8).
    - [x] Logic must return the specific "Evidence" (which historical rule or tokens triggered the match).

- [ ] **Task 3.4: Adaptive Pattern Learning**
    - [ ] **Rule Evolution:** When a user approves a `? suggested` match, update the existing pattern to incorporate the new variation (merging tokens).
    - [ ] **Conflict Management:** Flag patterns that match multiple entities for manual review.
- [ ] **Task 3.5: Transparency & Evidence UI**
    - [ ] **Visual Highlighting:** Use tokenizer metadata to highlight "Anchors" directly in the table rows.
    - [ ] **Evidence Modal:** Implement a central modal showing the current movement vs. the top 3 historical matches.

## Phase 4: Historical Records & Stability
**Objective:** Move from session-based tool to a permanent financial log for multi-month data.

- [x] **Task 4.1: The Vault (Persistent History)**
    - [x] Create a `Movements` table in IndexedDB (Dexie) to store reconciled data permanently.
    - [x] **Schema:** `id`, `date`, `description`, `amount`, `entity`, `category`, `reconciledAt`.
    - [x] **UX:** Implement the **"Save to History"** button on the Mapping tab — an iterative action that can be triggered at any point to persist all currently labeled rows to the vault. History tab shows all saved movements.

- [x] **Task 4.2: Duplicate Protection**
    - [x] **Ingestion Shield:** Automatically detect and skip rows already present in History (match by `date + amount + description`).
    - [x] **Collision UI:** Show summary of added vs. ignored (duplicate) movements.

- [x] **Task 4.3: History & Spending Insights (Tab 4)**
    - [x] **Monthly Browser:** Interface to explore reconciled data grouped by Month/Year.
    - [x] **Global Search:** Search bar to find any transaction across the entire history (descriptions, entity and value).

- [x] **Task 4.4: The Rules Library (Tab 3)**
    - [x] **Dictionary Management:** Searchable list of all learned "Dialects" and patterns (entity cards with scope-coloured chips).
    - [x] **Manual Cleanup:** Inline rename entity, delete entity, delete individual dialect pattern. "Clear Memory" button to wipe all rules.

- [x] **Task 4.5: Data Portability & Safety**
    - [x] **Import:** Upload a previously exported JSON backup — additive merge (entities/dialects/movements). Summary banner on completion.
    - [x] **Clean History:** Destructive "Clear History" button on the History tab with confirmation guard.
    - [ ] **Export:** Download the entire database (Rules + Movements) as a JSON file for backup and portability.

- [x] **Task 4.6: Ambiguity & Manual Discovery (Clear to Learn)**
    - [x] **Non-Unique Indexing:** `findAllMatchingEntities` collects all matching entities per pattern across all three tiers; existing schema already supports multiple entityIds per pattern.
    - [x] **Clear Match Action:** `[✕]` button on matched rows (auto, manual, ambiguous) clears the entity and resets to unknown state.
    - [x] **Additive Learning:** `dialectExists` guard prevents duplicate dialect entries; new entity associations are always added alongside existing ones (never overwrite).
    - [x] **Ambiguity State:** When > 1 entity matches, status is `⚠ Ambiguous`; clicking the field shows a candidate dropdown with match level badges and a manual-entry fallback.
- [ ] **Task 4.7: History Audit & Maintenance**
    - [ ] **Reprocess Button:** Identify historical rows that no longer align with the current rule library. Add Red ball in the tabs with number of rows with outdated matches so the user can see what months have issues (similar design as Iphone cards)
    - [ ] **Update Match Button:** Allow user to update past records to match newly learned/refined rules. This is done row by row    

## Phase 5: Automation & Final Polish
- [ ] **Task 5.1: Bulk Actions** (Apply entity to all similar rows in one click).
- [ ] **Task 5.2: Final UI Refinements & Empty States.**
- [ ] **Task 5.3: Offline/PWA Setup.**