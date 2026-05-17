# Requirements Document

## Introduction

This feature adds a "Tutti 工單" (Work Order) tab to the existing Tutti/Monitor section of the QC Web application. The tab displays an Excel-like spreadsheet grid (AG Grid) for managing Tutti panel production records. Data is persisted in a PostgreSQL RDS table (`panel_production.tutti_production`) on the `beadsdb` instance. The grid captures fill/weld process data per well and per line, post-process steps, and auto-calculates storage quantities.

## Glossary

- **App**: The QC Web IPQC application (React 19 + Vite + Tailwind CSS frontend, Express 5 backend)
- **AG_Grid**: The AG Grid Community library already installed in the App for rendering Excel-like spreadsheet grids
- **Tutti_Tab**: The new "Tutti 工單" sub-tab within the monitor view that displays the production record grid
- **Production_Record**: A single row in the `tutti_production` table representing one fill/weld process entry for a specific well and line
- **RDS_Database**: The PostgreSQL RDS instance at `database-1.cfutwrwyrxts.ap-northeast-1.rds.amazonaws.com:5432/beadsdb`
- **Backend**: The Express 5 server located in `/server` that provides REST API endpoints
- **Storage_Quantity**: The calculated value: 生產數量 (Production Quantity) minus 不良數量 (Defect Quantity) minus QA檢測 (QA Inspection count)
- **Work_Order_Header**: The header-level metadata for a production batch including LOT NO, work order number, product name, production quantity, and Model P/N

## Requirements

### Requirement 1: Tab Navigation

**User Story:** As a production operator, I want a "Tutti 工單" sub-tab within the Tutti/Monitor view, so that I can access the production record grid without leaving the Tutti section.

#### Acceptance Criteria

1. WHEN the user navigates to the monitor view for the first time in a session, THE App SHALL display a tab bar containing exactly two tabs labeled "預建線" and "工單", with "預建線" selected as the default active tab
2. WHEN the user clicks the "工單" tab, THE App SHALL render the Tutti_Tab component containing the AG_Grid production table and SHALL visually indicate "工單" as the active tab
3. WHEN the user clicks the "預建線" tab, THE App SHALL render the existing TuttiPage iframe content without triggering a full iframe reload if the iframe was previously loaded in the same session
4. WHEN the user navigates away from the monitor view and then returns within the same browser page lifecycle (no full page reload), THE App SHALL restore the tab that was last active before navigation away
5. WHEN the user performs a full page reload, THE App SHALL display the default "預建線" tab regardless of prior selection

### Requirement 2: PostgreSQL Schema and Table Creation

**User Story:** As a system administrator, I want the backend to connect to the RDS PostgreSQL instance and ensure the `panel_production` schema and `tutti_production` table exist, so that production records can be stored reliably.

#### Acceptance Criteria

1. WHEN the Backend starts, THE Backend SHALL establish a connection pool to the RDS_Database using the `pg` library with SSL enabled (rejectUnauthorized: false), configured with a minimum of 2 and maximum of 10 connections, and a connection timeout of 10000 milliseconds
2. WHEN the Backend initializes the database connection, THE Backend SHALL create the `panel_production` schema if it does not already exist, without modifying the schema if it already exists
3. WHEN the Backend initializes the database connection, THE Backend SHALL create the `tutti_production` table in the `panel_production` schema if it does not already exist, with columns for: id (serial primary key), lot_no (VARCHAR, NOT NULL, max 50 characters), work_order_number (VARCHAR, NOT NULL, max 50 characters), product_name (VARCHAR, max 100 characters), production_order_quantity (INTEGER), model_pn (VARCHAR, max 50 characters), sheet_name (VARCHAR, max 100 characters), line (INTEGER), well_position (INTEGER, constrained to values 1 through 10), reagent_slot (VARCHAR, max 50 characters), reagent_name (VARCHAR, max 100 characters), batch_number (VARCHAR, max 50 characters), quantity (NUMERIC), formula_number (VARCHAR, max 50 characters), welding_parameter_number (VARCHAR, max 50 characters), production_quantity (INTEGER), defect_quantity (INTEGER DEFAULT 0), qa_inspection (INTEGER DEFAULT 0), storage_quantity (INTEGER), labeling_status (VARCHAR, max 20 characters), diluent_box_status (VARCHAR, max 20 characters), assembly_status (VARCHAR, max 20 characters), packaging_status (VARCHAR, max 20 characters), boxing_status (VARCHAR, max 20 characters), created_at (TIMESTAMP, DEFAULT current timestamp), updated_at (TIMESTAMP, DEFAULT current timestamp), and created_by (VARCHAR, max 50 characters)
4. IF the connection to the RDS_Database fails during startup, THEN THE Backend SHALL log the error with connection details (host, port, database name, and username, excluding password) and continue operating all other routes without crashing
5. IF the connection pool loses connectivity to the RDS_Database after initial startup, THEN THE Backend SHALL attempt to re-establish the connection on the next database request, up to a maximum of 3 retry attempts with 2000 milliseconds between retries, before returning an error response to the caller

### Requirement 3: REST API for Production Records

**User Story:** As a frontend developer, I want CRUD API endpoints for Tutti production records, so that the AG_Grid can load, create, update, and delete records.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/tutti-production`, THE Backend SHALL return all Production_Record rows from the `panel_production.tutti_production` table ordered by created_at descending, as a JSON array with a maximum of 10000 rows
2. WHEN a GET request is made to `/api/tutti-production` with a `work_order` query parameter, THE Backend SHALL return only Production_Record rows whose work_order_number column contains the provided value as a substring (case-insensitive)
3. WHEN a POST request is made to `/api/tutti-production` with at minimum the required fields (lot_no, work_order_number), THE Backend SHALL insert a new Production_Record with created_at set to the current timestamp and return the created row including its generated id with HTTP status 201
4. WHEN a PUT request is made to `/api/tutti-production/:id` with one or more updatable fields, THE Backend SHALL update only the provided fields on the matching Production_Record, set updated_at to the current timestamp, and return the full updated row as JSON with HTTP status 200
5. WHEN a DELETE request is made to `/api/tutti-production/:id`, THE Backend SHALL delete the matching Production_Record and return a JSON object `{ "ok": true }` with HTTP status 200
6. IF a POST request is missing required fields (lot_no or work_order_number), THEN THE Backend SHALL return HTTP 400 with a JSON body containing an error property indicating the missing fields
7. IF a PUT request contains no updatable fields, THEN THE Backend SHALL return HTTP 400 with a JSON body containing an error property indicating nothing to update
8. IF a GET, PUT, or DELETE request references an id that does not exist in the tutti_production table, THEN THE Backend SHALL return HTTP 404 with a JSON body containing an error property indicating the record was not found

### Requirement 4: AG Grid Display

**User Story:** As a production operator, I want to see production records in an Excel-like grid with grouped columns and merged headers, so that the interface feels familiar and efficient like the Excel sheet I currently use.

#### Acceptance Criteria

1. WHEN the Tutti_Tab loads, THE AG_Grid SHALL display all Production_Record rows fetched from the Backend API in the order returned by the API (created_at descending)
2. THE AG_Grid SHALL group columns into the following header groups with explicit membership: "工單資訊" containing 批號, 工單號碼, 產品名稱, 製令數量, and Model P/N; "填充/熔接製程" containing 片名, 線別, 卡匣位置, 藥槽, 試劑名稱, 批次號, 數量, 配方編號, and 熔接參數編號; "生產記錄" containing 生產數量, 不良數量, QA檢測, and 入庫數量; "後製程" containing 貼標, 稀釋液盒製作, 組裝, 包裝, and 裝箱
3. THE AG_Grid SHALL render column headers in Chinese matching the Excel reference: 批號, 工單號碼, 產品名稱, 製令數量, Model P/N, 片名, 線別, 卡匣位置, 藥槽, 試劑名稱, 批次號, 數量, 配方編號, 熔接參數編號, 生產數量, 不良數量, QA檢測, 入庫數量, 貼標, 稀釋液盒製作, 組裝, 包裝, 裝箱
4. THE AG_Grid SHALL support column resizing (with a minimum column width of 50 pixels), sorting, and filtering on all columns
5. IF the Backend API returns zero Production_Record rows, THEN THE AG_Grid SHALL display the column headers and an empty-state message indicating no records are available

### Requirement 5: Inline Editing

**User Story:** As a production operator, I want to edit cell values directly in the grid, so that I can quickly update production records without opening a separate form.

#### Acceptance Criteria

1. WHEN the user double-clicks a cell in an editable column, THE AG_Grid SHALL enter edit mode for that cell, where editable columns are all columns except id, storage_quantity, created_at, and updated_at
2. WHEN the user finishes editing a cell (by pressing Enter or Tab or clicking outside the cell), THE AG_Grid SHALL send a PUT request to the Backend within 1 second of the edit confirmation to persist the change
3. IF the Backend returns an error during cell save, THEN THE AG_Grid SHALL revert the cell to its previous value and display an error notification indicating the save failure, visible for at least 5 seconds or until the user dismisses it
4. THE AG_Grid SHALL mark the storage_quantity, id, created_at, and updated_at columns as read-only and SHALL prevent those cells from entering edit mode on double-click
5. WHEN the user edits production_quantity, defect_quantity, or qa_inspection, THE AG_Grid SHALL recalculate and display the updated Storage_Quantity in the same row within the same user interaction before the PUT request completes
6. IF the user enters a non-numeric value in a numeric column (production_quantity, defect_quantity, qa_inspection, quantity), THEN THE AG_Grid SHALL reject the input, revert the cell to its previous value, and display a validation message indicating that only numeric values are accepted

### Requirement 6: Auto-Calculation of Storage Quantity

**User Story:** As a production operator, I want the storage quantity to be automatically calculated, so that I do not need to manually compute it and risk errors.

#### Acceptance Criteria

1. THE AG_Grid SHALL compute Storage_Quantity as: production_quantity minus defect_quantity minus qa_inspection, treating any null or empty input field as 0 for the purpose of calculation
2. IF the computed Storage_Quantity is negative, THEN THE AG_Grid SHALL display the value as 0 and show a validation warning indicating that defect and inspection quantities exceed production quantity
3. WHEN any of the three input values (production_quantity, defect_quantity, qa_inspection) changes, THE AG_Grid SHALL recalculate and display the updated Storage_Quantity in the same row within the same user interaction (no page reload required)
4. WHEN a new Production_Record is created, THE Backend SHALL compute and store the Storage_Quantity value using the same formula (production_quantity minus defect_quantity minus qa_inspection), treating any null or missing input field as 0, and clamping the result to a minimum of 0
5. WHEN a Production_Record is updated with changes to production_quantity, defect_quantity, or qa_inspection, THE Backend SHALL recompute and persist the updated Storage_Quantity using the same formula and clamping rules
6. THE AG_Grid SHALL accept production_quantity, defect_quantity, and qa_inspection as non-negative integer values from 0 to 99999 only, and SHALL reject any value outside this range by reverting the cell to its previous value

### Requirement 7: Record Creation

**User Story:** As a production operator, I want to add new production records to the grid, so that I can log new production batches.

#### Acceptance Criteria

1. WHEN the user clicks the "新增" (Add) button above the grid, THE Tutti_Tab SHALL insert a new empty row at the top of the grid in edit mode with all editable cells ready for input
2. WHEN the user fills in the required fields (lot_no, work_order_number) and confirms by pressing Enter or clicking a "儲存" (Save) button, THE Tutti_Tab SHALL send a POST request to the Backend to create the record
3. IF the user clicks the "取消" (Cancel) button or presses Escape on the new row without filling required fields, THEN THE Tutti_Tab SHALL remove the empty row without making any API call
4. WHEN the Backend returns a successful response containing the created record, THE Tutti_Tab SHALL display the new row in the grid with its server-generated id and created_at timestamp
5. IF the Backend returns a 400-level error response, THEN THE Tutti_Tab SHALL display an error message indicating the reason for failure and keep the new row in the grid with the user's entered data preserved
6. IF the user attempts to save the new row without filling in lot_no or work_order_number, THEN THE Tutti_Tab SHALL display a validation error message and prevent the API call from being sent

### Requirement 8: Record Deletion

**User Story:** As a production operator, I want to delete incorrect production records, so that the data remains accurate.

#### Acceptance Criteria

1. WHEN the user selects one or more rows and clicks the "刪除" (Delete) button, THE Tutti_Tab SHALL display a confirmation dialog stating the number of records selected for deletion
2. WHEN the user confirms deletion, THE Tutti_Tab SHALL send a DELETE request to the Backend for each selected record individually by record ID
3. WHEN all DELETE requests succeed, THE Tutti_Tab SHALL remove the deleted rows from the grid display within 2 seconds of the last successful response
4. IF deletion fails for any record, THEN THE Tutti_Tab SHALL display an error message indicating which record(s) failed and the reason, and keep the failed rows visible and selected in the grid
5. IF the user cancels the confirmation dialog, THEN THE Tutti_Tab SHALL close the dialog and leave the grid selection unchanged

### Requirement 9: Data Loading and Refresh

**User Story:** As a production operator, I want the grid to load data on tab activation and support manual refresh, so that I always see the latest production records.

#### Acceptance Criteria

1. WHEN the Tutti_Tab becomes the active view (via sidebar navigation or tab switch), THE AG_Grid SHALL fetch and display the latest Production_Record data from the Backend, sorted by creation date descending
2. WHEN the user clicks the "重新整理" (Refresh) button, THE AG_Grid SHALL reload all Production_Record data from the Backend and replace the currently displayed rows with the updated result set
3. WHILE data is being fetched from the Backend, THE Tutti_Tab SHALL display a loading indicator overlay on the grid area and disable the "重新整理" button until the fetch completes or fails
4. IF the data fetch fails (network error or Backend returns a non-success response) within a timeout of 30 seconds, THEN THE Tutti_Tab SHALL display an error message indicating the failure reason and provide a retry button that re-triggers the same fetch operation
5. IF the data fetch fails during a manual refresh, THEN THE Tutti_Tab SHALL retain the previously displayed data in the grid and show the error message as a non-blocking notification with a retry option

### Requirement 10: Work Order Filtering

**User Story:** As a production operator, I want to filter records by work order number, so that I can focus on a specific production batch.

#### Acceptance Criteria

1. THE Tutti_Tab SHALL provide a text input field labeled "工單號碼" above the grid, with a maximum input length of 50 characters, for filtering Production_Record rows by work order number
2. WHEN the user enters a work order number in the filter input and at least 300 milliseconds have elapsed since the last keystroke, THE AG_Grid SHALL display only Production_Record rows whose work_order_number field contains the entered text as a substring (case-insensitive)
3. WHEN the user clears the filter input, THE AG_Grid SHALL display all Production_Record rows
4. IF the filter input value matches zero Production_Record rows, THEN THE AG_Grid SHALL display an empty grid with a message indicating no records match the filter
5. WHILE the filter query is being processed, THE Tutti_Tab SHALL display a loading indicator on the grid
