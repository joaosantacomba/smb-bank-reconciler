# Project Context: SMB Local Bank Movements Reconciler

## Objective
Automate the reconciliation of bank statements (Excel) against pending names and invoices for SMBs (PMEs), focusing on the 80% of repetitive, predictable cases.

## Non-Negotiable Rules (Hard Rules)
1. **Total Privacy:** No financial data shall ever leave the user's browser. Do not implement backend APIs or cloud databases.
2. **Local-First:** All Excel parsing and matching logic must occur 100% on the client side.
3. **Persistence:** Matching rules and session context must be exportable to JSON and stored locally via Browser LocalStorage.
4. **Explicit Decision Making:** The AI agent must propose a technical plan and wait for approval before modifying `.ts`, `.html`, or `.scss` files. Decisions must be recorded in `architecture.md` first.

## Tech Stack
- **Frontend:** Angular (v19+) with SCSS.
- **UI:** Tailwind CSS.
- **Libraries:** SheetJS (xlsx) for client-side Excel parsing.