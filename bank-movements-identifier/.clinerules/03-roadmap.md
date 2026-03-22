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
- [ ] **Task 2.4: Smart Matching & Entity Normalization**
    - [ ] **Description Normalizer:** Logic to strip noise (dates like `01/03`, transaction IDs, and extra spaces) from bank strings.
    - [ ] **Fuzzy Matching (Levenshtein):** Implement similarity scoring for non-exact matches. 
        - Formula: $S(A, B) = 1 - \frac{\text{dist\_levenshtein}(A, B)}{\max(|A|, |B|)}$
    - [ ] **Entity Autocomplete:** Suggest existing entities during manual input to prevent duplicates (e.g., "Continente" vs "Continente S.A.").
    - [ ] **Fuzzy Badge UI:** New `? Maybe` (orange) state for matches with $>80\%$ confidence.
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
    - [ ] **Rule Evolution:** When a user approves a `? suggested` match, the system must update the existing pattern in IndexedDB to incorporate the new variation (merging tokens).
    - [ ] **Conflict Management:** If a pattern could match multiple entities, flag it for manual review instead of auto-matching.

- [ ] **Task 3.5: Transparency & Evidence UI**
    - [ ] **Status Badges:** Implement `✓ auto` (Green/Exact/Structural) and `? suggested` (Orange/Similarity) labels.
    - [ ] **Visual Highlighting:** Use the tokenizer metadata to highlight "Anchors" directly in the table row (bold or underlined).
    - [ ] **Evidence Modal:** - Add a "Details" button to every matched row.
        - Open a central modal showing the current movement side-by-side with the **top 3 historical matches** for that entity.
    - [ ] **Smart Autocomplete:** When typing an entity, prioritize names that have already been matched

## Phase 4: Historical Insights & Portability
- [ ] **Task 4.1: Memory Management Tab**
    - [ ] CRUD interface for the Rules Dictionary (Edit/Delete learned patterns).
- [ ] **Task 4.2: Monthly History & Reporting**
    - [ ] Grouped view of reconciled movements by month/category.
- [ ] **Task 4.3: Data Portability**
    - [ ] JSON Export/Import for Rules and History (Backup/Privacy control).

## Phase 5: Automation & Final Polish
- [ ] **Task 5.1: Bulk Actions**
    - [ ] "Apply this entity to all similar rows" in one click.
- [ ] **Task 5.2: Final Export**
    - [ ] Export reconciled data to cleaned CSV/Excel.
- [ ] **Task 5.3: Offline/PWA**
    - [ ] Service Worker setup for full offline use.