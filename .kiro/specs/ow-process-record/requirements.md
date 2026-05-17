# Requirements Document

## Introduction

This feature implements a web-based input page and database for the "OW" sheet (Panel 製程紀錄表), replicating the Excel-based manufacturing process record system used for QC/IPQC panel production. The system captures work order header information, material usage confirmation, well-by-well fill/weld process data across multiple production lines, and post-process step confirmations. It integrates with the existing React + Express + SQLite stack.

## Glossary

- **OW_Record**: A complete Panel 製程紀錄表 (Panel Process Record) entry, encompassing header info, materials, fill/weld data, and post-process steps for a single production lot
- **Work_Order**: The manufacturing work order (工單號碼) that identifies a production run, e.g., "UMRZ26D036"
- **LOT_NO**: The lot identification number assigned to a production batch, e.g., "1-0000007-26041701"
- **Material_Entry**: A single row in the material usage confirmation section, linking an operation to a specific part with batch traceability
- **Fill_Weld_Row**: A single well-level record within the fill/weld process section, capturing reagent slot assignments, batch numbers, quantities, and yield data for one well on one production line
- **Post_Process_Step**: A confirmation record for a post-production operation (labeling, diluent box making, assembly, packaging, or boxing)
- **Production_Line**: A manufacturing line identifier (e.g., "L1", "L2") used in the fill/weld process
- **Well_Position**: A cartridge position (well 1 through well 10) within a production line
- **API_Server**: The Express 5 backend server running on the existing application
- **Form_Page**: The React frontend page providing the data entry interface
- **Database**: The SQLite database (WAL mode) storing all OW process records

## Requirements

### Requirement 1: Database Schema Creation

**User Story:** As a system administrator, I want the OW process record data stored in a structured SQLite database, so that records are persistent, queryable, and maintain referential integrity.

#### Acceptance Criteria

1. WHEN the API_Server starts, THE Database SHALL create the OW record tables if they do not already exist, preserving any existing data
2. THE Database SHALL store OW_Record header fields including lot_no (TEXT, NOT NULL), product_name (TEXT, NOT NULL), work_order (TEXT, NOT NULL), code_a (TEXT), production_quantity (INTEGER), and model_pn (TEXT), with lot_no limited to a maximum of 50 characters and work_order limited to a maximum of 50 characters
3. THE Database SHALL store Material_Entry records linked to an OW_Record by a foreign key relationship, with fields for material_name (TEXT, NOT NULL), batch_no (TEXT), expiry_date (TEXT), and quantity (REAL)
4. THE Database SHALL store Fill_Weld_Row records linked to an OW_Record by a foreign key relationship, with fields for line (INTEGER, NOT NULL), well_position (TEXT), reagent_slot_1 (TEXT), reagent_name_1 (TEXT), batch_no_1 (TEXT), quantity_1 (REAL), reagent_slot_2 (TEXT), reagent_name_2 (TEXT), batch_no_2 (TEXT), quantity_2 (REAL), formula_no (TEXT), weld_param_no (TEXT), production_qty (INTEGER DEFAULT 0), defect_qty (INTEGER DEFAULT 0), qa_inspection_qty (INTEGER DEFAULT 0), and storage_qty (INTEGER DEFAULT 0)
5. THE Database SHALL store Post_Process_Step records linked to an OW_Record by a foreign key relationship, with fields for step_order (INTEGER, NOT NULL), step_name (TEXT, NOT NULL), operator (TEXT), and completed_at (TEXT)
6. THE Database SHALL enforce that storage_qty equals production_qty minus defect_qty minus qa_inspection_qty via a CHECK constraint or application-level validation
7. THE Database SHALL use INTEGER PRIMARY KEY AUTOINCREMENT for all table primary keys
8. THE Database SHALL create indexes on work_order and lot_no columns of the OW_Record table for efficient querying
9. IF an OW_Record is deleted, THEN THE Database SHALL cascade the deletion to all associated Material_Entry, Fill_Weld_Row, and Post_Process_Step records via ON DELETE CASCADE foreign key constraints

### Requirement 2: Create OW Process Record

**User Story:** As a production operator, I want to create a new OW process record through a web form, so that I can digitize the paper/Excel-based recording process.

#### Acceptance Criteria

1. WHEN a POST request to the API endpoint contains the required header fields (lot_no, work_order, production_quantity) with production_quantity as a positive integer, THE API_Server SHALL insert the header, materials, fill/weld rows, and post-process steps within a single database transaction
2. WHEN the transaction completes successfully, THE API_Server SHALL return a JSON response containing the created record ID with HTTP status 201
3. IF any part of the transaction fails, THEN THE API_Server SHALL roll back all changes and return an error message indicating the nature of the failure with HTTP status 500
4. WHEN a POST request is missing required header fields (lot_no, work_order, production_quantity) or production_quantity is not a positive integer, THE API_Server SHALL return HTTP status 400 with an error message identifying which fields failed validation
5. WHEN a POST request contains a lot_no and work_order combination that already exists in the Database, THE API_Server SHALL return HTTP status 409 with an error message indicating the duplicate
6. WHEN a POST request provides empty arrays for materials, fill/weld rows, or post-process steps, THE API_Server SHALL accept the request and create the OW_Record header with no child records for those sections
7. IF the payload contains more than 50 Material_Entry rows, more than 100 Fill_Weld_Row records, or more than 10 Post_Process_Step records, THEN THE API_Server SHALL return HTTP status 400 with an error message indicating which collection exceeded its limit

### Requirement 3: Retrieve OW Process Records

**User Story:** As a QC engineer, I want to view existing OW process records, so that I can review production history and audit manufacturing data.

#### Acceptance Criteria

1. WHEN a GET request is made to the list endpoint, THE API_Server SHALL return a paginated list of OW_Record headers sorted by creation date descending, using `limit` (default 20, maximum 100) and `offset` (default 0) query parameters, and the response SHALL include the total matching record count, the applied limit, and the applied offset
2. WHEN a GET request includes a work_order query parameter, THE API_Server SHALL filter results to records whose work_order field contains the parameter value as a substring (case-insensitive partial match)
3. WHEN a GET request includes a lot_no query parameter, THE API_Server SHALL filter results to records whose lot_no field contains the parameter value as a substring (case-insensitive partial match)
4. WHEN a GET request includes both work_order and lot_no query parameters, THE API_Server SHALL return only records matching both filters (AND logic)
5. WHEN a GET request is made to the detail endpoint with a valid record ID, THE API_Server SHALL return the complete OW_Record including all associated materials, fill/weld rows, and post-process steps
6. IF a GET request references a non-existent record ID, THEN THE API_Server SHALL return HTTP status 404
7. IF a GET request provides a non-numeric or negative value for limit or offset, THEN THE API_Server SHALL apply the default values (limit 20, offset 0) instead of rejecting the request

### Requirement 4: Update OW Process Record

**User Story:** As a production operator, I want to edit an existing OW process record, so that I can correct data entry errors or add missing information.

#### Acceptance Criteria

1. WHEN a valid PUT request is made with a record ID, THE API_Server SHALL replace the header fields and delete then re-insert all associated materials, fill/weld rows, and post-process steps within a single database transaction
2. WHEN the update transaction completes successfully, THE API_Server SHALL return the complete updated OW_Record including all associated materials, fill/weld rows, and post-process steps with HTTP status 200
3. IF the record ID does not exist, THEN THE API_Server SHALL return HTTP status 404
4. WHEN a PUT request is missing required header fields (lot_no, work_order, production_quantity), THE API_Server SHALL return HTTP status 400 with an error message indicating which fields are missing
5. IF any part of the update transaction fails, THEN THE API_Server SHALL roll back all changes and return an error message with HTTP status 500

### Requirement 5: Delete OW Process Record

**User Story:** As a QC engineer, I want to delete an OW process record, so that I can remove erroneous or duplicate entries.

#### Acceptance Criteria

1. WHEN a DELETE request is made with a record ID that exists in the database, THE API_Server SHALL delete the OW_Record header and all associated Material_Entry rows, Fill_Weld_Row rows, and Post_Process_Step rows within a single database transaction
2. WHEN the deletion transaction completes successfully, THE API_Server SHALL return HTTP status 200 with a JSON body containing the total number of rows deleted across all tables (header + materials + fill/weld rows + post-process steps)
3. IF the deletion transaction fails after partially executing, THEN THE API_Server SHALL roll back all changes and return HTTP status 500 with an error message indicating the failure reason
4. IF the record ID does not exist, THEN THE API_Server SHALL return HTTP status 404 with an error message indicating the record was not found
5. IF the record ID in the request is not a positive integer, THEN THE API_Server SHALL return HTTP status 400 with an error message indicating the invalid identifier format

### Requirement 6: Header Information Form Section

**User Story:** As a production operator, I want to enter work order header information in a structured form, so that each record is properly identified and traceable.

#### Acceptance Criteria

1. THE Form_Page SHALL display input fields for LOT_NO (max 30 characters), product_name (max 100 characters), work_order (max 30 characters), code_a (max 30 characters), production_quantity, and model_pn (max 50 characters)
2. THE Form_Page SHALL mark lot_no, work_order, and production_quantity as required fields by displaying an asterisk (*) adjacent to each required field label
3. WHEN a user submits the form with any required field (lot_no, work_order, or production_quantity) left empty, THE Form_Page SHALL display a validation message below the empty field indicating the field is required, and SHALL NOT submit data to the server
4. THE Form_Page SHALL accept production_quantity as a positive integer value between 1 and 9,999,999 only
5. IF a user enters a non-integer value, a value less than 1, or a value greater than 9,999,999 into the production_quantity field, THEN THE Form_Page SHALL display a validation message below the field indicating the accepted range and SHALL prevent form submission

### Requirement 7: Material Usage Confirmation Section (入料)

**User Story:** As a production operator, I want to confirm material usage details in a fixed-row table, so that material traceability is maintained for the production lot with pre-defined item names and default part numbers.

#### Acceptance Criteria

1. THE Form_Page SHALL display a fixed-row table for Material_Entry input with exactly 11 rows, one for each pre-defined item: 卡匣-RL, 卡匣- (row 2), 卡匣- (row 3), 上蓋, 標籤, 稀釋液盒, 鋁膜, 稀釋液, 包裝盒, 乾燥劑, 包裝鋁膜
2. THE Form_Page SHALL display columns for 品名 (item_name), 料號 (part_number, maximum 50 characters), 版本 (version, maximum 20 characters), 穴號 (well_number), and 批次號 (batch_number, maximum 50 characters)
3. THE Form_Page SHALL render the 品名 column as read-only text that is not editable by the user
4. THE Form_Page SHALL pre-fill the 料號 column with the following default values: "7B00000379H-A" for 卡匣-RL, "7B00000379H-A" for 卡匣- (row 2), empty for 卡匣- (row 3), "7B00000380H-A" for 上蓋, "7B24000396H-A" for 標籤, "7B00000392H-A" for 稀釋液盒, "7B08000050-A" for 鋁膜, empty for 稀釋液, "7B00000368H-A(單入)" for 包裝盒, "7B11000144A" for 乾燥劑, and "7B08000051-A" for 包裝鋁膜
5. THE Form_Page SHALL pre-fill the 版本 column with "C1" for the first row (卡匣-RL) and leave other rows empty by default, while allowing the user to edit the version value on any row
6. THE Form_Page SHALL allow the user to edit the 料號 column values on all rows, overriding the pre-filled defaults
7. THE Form_Page SHALL provide editable input fields for 穴號 and 批次號 columns that support text input, copy, paste, and erase operations
8. THE Form_Page SHALL allow 批次號 fields to remain blank without triggering validation errors upon form submission
9. THE Form_Page SHALL NOT allow adding or removing rows from the material table; the table structure remains fixed at 11 rows

### Requirement 8: Fill and Weld Process Section (填藥熔接)

**User Story:** As a production operator, I want to enter well-by-well fill/weld process data for each production line, so that reagent assignments, process parameters, and yield data are captured at the well level.

#### Acceptance Criteria

1. THE Form_Page SHALL display a grid for Fill_Weld_Row input organized by Production_Line (L1, L2, etc.) with exactly 10 fixed well positions per line (well 1 through well 10), where the 卡匣位置 (Cartridge Position) column is read-only and not editable
2. THE Form_Page SHALL organize the grid into three column groups: 材料使用確認 (Material Usage Confirmation), 製程參數確認 (Process Parameter Confirmation), and 生產記錄 (Production Record)
3. THE Form_Page SHALL provide the following fields per well in the 材料使用確認 group: 藥槽1 (reagent_slot_1, editable text), 試劑名稱1 (reagent_name_1, dropdown), 批次號1 (batch_no_1, editable text, initially blank), 數量1 (quantity_1, editable numeric, initially blank), 藥槽2 (reagent_slot_2, editable text), 試劑名稱2 (reagent_name_2, dropdown), 批次號2 (batch_no_2, editable text, initially blank), and 數量2 (quantity_2, editable numeric, initially blank)
4. THE Form_Page SHALL render the 試劑名稱 (reagent_name) fields as dropdown selectors populated with distinct marker values retrieved from the GET /api/ow-process/markers endpoint
5. THE Form_Page SHALL pre-fill the 藥槽 (reagent_slot) fields for L1 with the following defaults: well 1 slot1=1A1 slot2=1D1, well 2 slot1=1C1 slot2=1F1, well 3 slot1=1A2 slot2=1D2, well 4 slot1=1C2 slot2=1F2, well 5 slot1=1B1 slot2=1E1, well 6 empty, well 7 slot1=1A3 slot2=1D3, well 8 slot1=1C3 slot2=1F3, well 9 slot1=1A4 slot2=1D4, well 10 slot1=1C4 slot2=1F4
6. THE Form_Page SHALL pre-fill the 藥槽 (reagent_slot) fields for L2 with the same positional pattern as L1 but using prefix "2" instead of "1" (e.g., well 1 slot1=2A1 slot2=2D1, well 2 slot1=2C1 slot2=2F1, etc.)
7. THE Form_Page SHALL allow the user to edit the pre-filled 藥槽 values on any well
8. THE Form_Page SHALL provide input fields for 配方編號 (formula_no, max 50 characters) and 熔接參數編號 (weld_param_no, max 50 characters) per well in the 製程參數確認 group, initially blank
9. THE Form_Page SHALL provide input fields for 生產數量(a) (production_qty), 不良數量(b) (defect_qty), and QA檢測(c) (qa_inspection_qty) per well in the 生產記錄 group, each accepting non-negative integer values from 0 to 99999, initially blank
10. WHEN 生產數量(a), 不良數量(b), and QA檢測(c) are entered for a well, THE Form_Page SHALL auto-calculate and display 入庫數量 as (a)-(b)-(c)
11. IF the auto-calculated 入庫數量 is negative, THEN THE Form_Page SHALL display 入庫數量 as 0 and show a validation warning indicating that defect and inspection quantities exceed production quantity
12. THE Form_Page SHALL allow adding and removing Production_Line sections dynamically, maintaining at least 1 line at all times
13. THE Form_Page SHALL allow partial well entry, where fields for individual wells may be left empty without blocking form submission

### Requirement 9: Post-Process Steps Section

**User Story:** As a production operator, I want to confirm post-process steps (labeling, assembly, packaging, etc.), so that downstream operations are documented with parameter verification.

#### Acceptance Criteria

1. THE Form_Page SHALL display sections for each Post_Process_Step: 貼標 (Labeling), 稀釋液盒製作 (Diluent Box Making), 組裝 (Assembly), 包裝 (Packaging), 裝箱 (Boxing)
2. THE Form_Page SHALL provide input fields for each step including: file_name (檔案名稱, max 100 characters), formula_no (配方編號, max 50 characters), product_batch (成品批次, max 50 characters), product_expiry (成品效期, date in YYYY-MM-DD format), confirmed_by (確認人員, max 50 characters), and confirmed_date (確認日期, date in YYYY-MM-DD format)
3. THE Form_Page SHALL provide a process_param_confirmed (製程參數確認) checkbox for each step, defaulting to unchecked
4. WHEN confirmed_date is not manually entered, THE Form_Page SHALL default to the current date in YYYY-MM-DD format
5. THE Form_Page SHALL allow each Post_Process_Step section to be left incomplete, permitting the operator to fill only the steps that have been performed
6. IF a Post_Process_Step has any field filled, THEN THE Form_Page SHALL require confirmed_by and confirmed_date for that step before form submission
7. WHEN a user submits the form with a Post_Process_Step that has confirmed_by or confirmed_date missing while other fields in that step are filled, THE Form_Page SHALL display an inline validation error indicating the missing required fields

### Requirement 10: Record List and Navigation

**User Story:** As a QC engineer, I want to browse and search existing OW process records, so that I can quickly find and review specific production records.

#### Acceptance Criteria

1. THE Form_Page SHALL include a list view showing OW_Record headers with columns for lot_no, work_order, product_name, production_quantity, and created_at, sorted by created_at descending, displaying a maximum of 50 records per page
2. THE Form_Page SHALL provide a search input that filters records by performing a case-insensitive substring match against work_order or lot_no, triggered after the user has entered at least 2 characters
3. WHEN a user clicks on a record in the list view, THE Form_Page SHALL navigate to the edit form pre-populated with that record's data
4. THE Form_Page SHALL provide a "New Record" button that navigates to an empty form
5. IF the list view contains no records or the search yields no matching results, THEN THE Form_Page SHALL display a message indicating that no records were found

### Requirement 11: Form Submission and Feedback

**User Story:** As a production operator, I want clear feedback when saving records, so that I know whether my data was saved successfully or if errors need correction.

#### Acceptance Criteria

1. WHEN the form is submitted successfully, THE Form_Page SHALL display a success notification within 1 second of receiving the server response, and SHALL remain on the current record in edit mode with the saved values reflected in all fields
2. IF the form submission fails due to a server error, THEN THE Form_Page SHALL display an error notification containing the server-provided error message, and SHALL keep the notification visible until the user dismisses it or retries submission
3. WHILE the form is being submitted, THE Form_Page SHALL disable the submit button and display a loading indicator within 200 milliseconds of submission initiation, preventing duplicate submissions
4. IF the form submission fails, THEN THE Form_Page SHALL preserve all user-entered field values in their pre-submission state, enabling the user to retry submission without re-entering data
5. IF the form submission does not receive a server response within 30 seconds, THEN THE Form_Page SHALL treat the submission as failed, display a timeout error notification, and re-enable the submit button

### Requirement 12: API Route Integration

**User Story:** As a developer, I want the OW process record API to follow existing project conventions, so that the codebase remains consistent and maintainable.

#### Acceptance Criteria

1. THE API_Server SHALL expose OW process record endpoints under the path prefix /api/ow-process
2. THE API_Server SHALL register the route module in server/index.js by adding an ES module default import from './routes/owProcess.js' and a corresponding app.use('/api/ow-process', owProcessRoutes) call, placed after the existing route registrations
3. THE API_Server SHALL implement the route handler in a new file server/routes/owProcess.js that creates a Router instance via express Router() and exports it as the default export
4. THE API_Server SHALL use the shared database connection by importing the default export from '../db/sqlite.js' for all database operations within the route handler
5. IF a database operation within an OW process record endpoint throws an error, THEN THE API_Server SHALL return a JSON response with an error property containing the error message and an HTTP status code of 500

### Requirement 13: Markers API Endpoint

**User Story:** As a production operator, I want the reagent name dropdown to be populated with marker values from the external database, so that I can select from a standardized list of reagent names.

#### Acceptance Criteria

1. THE API_Server SHALL provide a GET /api/ow-process/markers endpoint that queries the external database at /home/ubuntu/bead_ipqc_spec.db, table bead_ipqc_spec, column marker
2. WHEN a GET request is made to /api/ow-process/markers, THE API_Server SHALL return a JSON response containing a distinct sorted list of marker values from the bead_ipqc_spec table
3. THE API_Server SHALL sort the marker values in ascending alphabetical order
4. THE API_Server SHALL exclude NULL and empty string values from the returned marker list
5. IF the external database file at /home/ubuntu/bead_ipqc_spec.db is not accessible, THEN THE API_Server SHALL return HTTP status 500 with an error message indicating the database connection failure
6. WHEN the markers endpoint returns successfully, THE API_Server SHALL return HTTP status 200 with a JSON body containing an array property "markers" holding the distinct sorted marker strings
