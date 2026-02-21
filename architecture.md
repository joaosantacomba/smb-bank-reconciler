# Architecture: SMB Local Bank Movements Reconciler

## Core Principles
- **Client-Side Only:** Processing and logic execution occur within the user's browser.
- **Modularity:** Independent services for parsing, matching, and storage.
- **Scalability:** Efficient handling of datasets within browser memory limits.

## Components
1. **UI Layer (Angular):** Handles user interaction. Styled with Tailwind CSS.
2. **Excel Parser (SheetJS):** - **ExcelParserService:** Centralized parsing logic.
    - **Method:** `parseExcelFile(file: File)` returns `Promise<string[][]>`.
    - **Localization Heuristic:** Determines the decimal separator by comparing the last positions of `.` and `,`. If `,` is further right than `.`, it is treated as the decimal separator (European/PT standard).
3. **Matching Engine:** Implements fuzzy matching and rule-based logic.
4. **Local Storage Manager:** Manages persistence of rules and settings using Browser LocalStorage.
5. **Data Models:** Uses `RawData` (string[][]) for initial parsing to avoid SheetJS auto-conversion errors.

## Data Flow
1. User uploads Excel via Drag & Drop.
2. `ExcelParserService` reads file as `ArrayBuffer` and converts to raw 2D array.
3. User validates headers and number formatting.
4. Data is fed into the Matching Engine.
5. Rules are applied and results are stored in LocalStorage.

## Security Considerations
- **No Server-Side Data:** Zero risk of centralized data breaches.
- **Browser Sandboxing:** Data is isolated within the local session.