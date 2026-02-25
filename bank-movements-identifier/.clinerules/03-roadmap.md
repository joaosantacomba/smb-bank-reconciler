# Roadmap: SMB Local Bank Movements Reconciler

## Phase 1: Core Functionality (MVP)
**Objective:** Implement the fundamental features for local reconciliation.

- [x] Set up Angular project with Tailwind CSS.
- [x] **Task 1.1: Core Infrastructure & Parsing**
    - [x] Technical analysis and implementation plan approved.
    - [x] Install `xlsx` and `@types/xlsx`.
    - [x] Implement `ExcelParserService` (using `ArrayBuffer` and localization heuristic).
- [x] **Task 1.2: Intelligent Row & Column Identification**
    - [x] Logic to automatically identify "actual movement" rows vs. irrelevant rows.
    - [x] Automatic header detection and metadata flagging.
- [ ] **Task 1.3: Upload & Mapping UI**
    - [ ] Develop Drag & Drop UI.
    - [ ] Create data preview table with row highlighting.
    - [ ] Build controls for manual column mapping ('Date', 'Description', 'Amount').
- [ ] **Task 1.4: Initial Matching & Persistence**
    - [ ] Implement exact and simple fuzzy matching.
    - [ ] Enable LocalStorage saving/loading for rules.

## Phase 2: Enhanced Matching & Usability
- [ ] Advanced fuzzy matching (Levenshtein).
- [ ] User-definable rule sets and UI for rule management.
- [ ] Bulk actions and confidence scores.
- [ ] Export to CSV/Excel.

## Phase 3: Automation & Integrations
- [ ] Machine learning suggestions (Local-only).
- [ ] Offline capabilities (PWA).

## Future Considerations
- [ ] Community Rule templates (Privacy-preserving).
- [ ] Multi-currency support.