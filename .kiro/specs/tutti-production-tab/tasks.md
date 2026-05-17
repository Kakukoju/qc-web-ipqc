# Implementation Plan: Tutti Production Tab

## Overview

This plan implements the "Tutti 工單" (Work Order) sub-tab within the Tutti/Monitor view. The implementation proceeds bottom-up: PostgreSQL connection and schema setup, REST API endpoints, frontend API client, AG Grid production tab component, and finally the tab navigation system wiring everything together.

## Tasks

- [x] 1. Set up PostgreSQL connection pool and schema initialization
  - [x] 1.1 Create `server/db/pgPool.js` with pg Pool configuration and schema/table initialization
    - Configure pool with RDS connection details (host, port, database, user, SSL)
    - Pool settings: min 2, max 10, connectionTimeoutMillis 10000
    - Implement `initPg()` function that creates `panel_production` schema and `tutti_production` table with all columns, constraints, and indexes as specified in the design
    - Implement retry logic: on connection loss, retry up to 3 times with 2000ms delay
    - Log connection errors with host, port, database, username (no password) on failure
    - Export `pool` and `initPg`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Integrate `pgPool.js` initialization into `server/index.js`
    - Import and call `initPg()` during server startup
    - Ensure server continues operating other routes if RDS connection fails
    - _Requirements: 2.4_

- [x] 2. Implement REST API endpoints for production records
  - [x] 2.1 Create `server/routes/tuttiProduction.js` with CRUD endpoints
    - GET `/api/tutti-production` — return all records ordered by created_at DESC, max 10000 rows; support optional `work_order` query param for case-insensitive substring filtering via ILIKE
    - POST `/api/tutti-production` — validate required fields (lot_no, work_order_number), compute storage_quantity using `max(0, prod - defect - qa)`, insert and return created row with HTTP 201
    - PUT `/api/tutti-production/:id` — validate at least one updatable field provided, recompute storage_quantity if relevant fields change, update only provided fields + updated_at, return updated row with HTTP 200; return 404 if id not found
    - DELETE `/api/tutti-production/:id` — delete record, return `{ "ok": true }` with HTTP 200; return 404 if id not found
    - Return HTTP 400 for missing required fields or empty update payload
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 6.4, 6.5_

  - [x] 2.2 Register the new route in `server/index.js`
    - Import `tuttiProduction.js` and mount at `/api/tutti-production`
    - _Requirements: 3.1_

  - [ ]* 2.3 Write property tests for storage quantity calculation (Property 1)
    - **Property 1: Storage quantity calculation correctness**
    - Use fast-check to generate random (nullable) integer triples in [0, 99999]
    - Verify `computeStorageQuantity` returns `max(0, (prod ?? 0) - (defect ?? 0) - (qa ?? 0))`
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.2, 6.3, 5.5**

  - [ ]* 2.4 Write property tests for numeric range validation (Property 6)
    - **Property 6: Numeric range validation**
    - Use fast-check to generate random integers, verify acceptance only for [0, 99999]
    - Minimum 100 iterations
    - **Validates: Requirements 6.6**

- [x] 3. Checkpoint - Ensure backend compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement frontend API client
  - [x] 4.1 Create `src/api/tuttiProduction.ts` with typed API functions
    - Define `TuttiProductionRecord` interface matching all table columns
    - Implement `fetchTuttiProduction(workOrder?: string)` — GET with optional query param
    - Implement `createTuttiProduction(data)` — POST with partial record
    - Implement `updateTuttiProduction(id, fields)` — PUT with partial fields
    - Implement `deleteTuttiProduction(id)` — DELETE by id
    - Use the existing `apiUrl` helper from `src/api/base.ts`
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

- [x] 5. Implement AG Grid production tab component
  - [x] 5.1 Create `src/components/Tutti/TuttiProductionTab.tsx` with AG Grid setup
    - Define column definitions with 4 header groups: 工單資訊, 填充/熔接製程, 生產記錄, 後製程
    - Map all fields to Chinese column headers as specified in design
    - Set editable: true on all columns except id, storage_quantity, created_at, updated_at
    - Configure minimum column width of 50px, enable resizing, sorting, and filtering
    - Implement `computeStorageQuantity` helper for client-side calculation
    - Display empty-state message when no records are available
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 6.3_

  - [x] 5.2 Implement inline editing with auto-save and validation
    - On cell edit complete, send PUT request to backend within 1 second
    - Revert cell value and show error toast (5+ seconds) on save failure
    - Recalculate storage_quantity on production_quantity/defect_quantity/qa_inspection change before PUT
    - Validate numeric columns: reject non-numeric input, reject values outside [0, 99999], revert and show validation message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.6_

  - [x] 5.3 Implement record creation (新增 button)
    - Add "新增" button above grid; on click, insert empty row at top in edit mode
    - On save (Enter or 儲存 button), validate required fields (lot_no, work_order_number), POST to backend
    - On cancel (Escape or 取消 button), remove empty row without API call
    - Display validation error if required fields missing; prevent API call
    - On success, update row with server-generated id and created_at
    - On 400 error, show error message and preserve user input
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.4 Implement record deletion (刪除 button)
    - Enable row selection (checkbox column)
    - Add "刪除" button; on click, show confirmation dialog with count of selected records
    - On confirm, send DELETE for each selected record by id
    - On success, remove deleted rows from grid within 2 seconds
    - On failure, show error indicating which records failed; keep failed rows selected
    - On cancel, close dialog and leave selection unchanged
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.5 Implement data loading, refresh, and work order filtering
    - Fetch data on component activation (isActive prop becomes true)
    - Add "重新整理" (Refresh) button; reload all data on click
    - Show loading overlay during fetch; disable refresh button while loading
    - On fetch failure (or 30s timeout), show error with retry button; retain previous data on refresh failure
    - Add "工單號碼" text input (maxLength 50) above grid for filtering
    - Debounce filter input by 300ms; call API with work_order param
    - Show loading indicator during filter query; show "no records match" message for zero results
    - On clear filter, reload all records
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 6. Checkpoint - Ensure frontend components compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement tab navigation in monitor view
  - [x] 7.1 Create `src/components/Tutti/TuttiMonitorView.tsx` with tab bar
    - Render tab bar with "預建線" and "工單" tabs; default to "預建線"
    - Conditionally render TuttiPage iframe or TuttiProductionTab based on active tab
    - Preserve iframe loaded state to avoid reload when switching back
    - Store tab state in component state (resets on full page reload)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 7.2 Update `src/App.tsx` to use TuttiMonitorView for the monitor view
    - Replace `<TuttiPage />` with `<TuttiMonitorView />` in the monitor view render
    - Preserve tab state across sidebar navigation within same page lifecycle
    - _Requirements: 1.4_

- [x] 8. Final checkpoint - Ensure full application compiles and all features are wired together
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The backend uses JavaScript (ES modules) matching existing server code; the frontend uses TypeScript matching existing src/ code
- AG Grid Community edition is already installed — no new dependencies needed for the grid
- The `pg` library is already installed in the server — no new backend dependencies needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "4.1"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "5.5"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2"] }
  ]
}
```
