# Requirements Document

## Introduction

This feature adds a "Tutti 工單" (Work Order) tab to the existing TuttiPage in the QC Web IPQC application. The tab provides an Excel-like grid interface for managing Panel 製程紀錄表 (production process records) stored in a remote SQLite database (`panel_production.db`) on the beadsdb server. The feature is part of the "Gemini MRP: Advanced Planning Simulator" concept and enables production staff to create, view, and edit work order records with a familiar spreadsheet-like experience using AG Grid.

## Glossary

- **TuttiPage**: The existing React page component that currently renders only an iframe pointing to `/qc-web/pre-assignment/`
- **Work_Order_Tab**: The new "工單" tab within TuttiPage that displays the production process record grid
- **AG_Grid**: The AG Grid Community library (v32.3.x) already installed in the project, used for Excel-like table rendering and editing
- **Remote_DB**: The SQLite database file at `/opt/beadsops/data/panel_production.db` on the remote server (54.199.19.240), accessed via SSH tunnel
- **Production_Record**: A single row in the `tutti_production` table representing one work order's complete production process data
- **Express_API**: The Express 5 backend server that handles CRUD operations and tunnels queries to the remote SQLite database via SSH
- **SSH_Tunnel**: The ssh2-based connection pattern used to execute sqlite3 commands on the remote beadsdb server (host=54.199.19.240, user=ec2-user)
- **Materials_Section**: The 入料 (material usage) portion of the production record, stored as a JSON blob
- **Fill_Weld_Section**: The 填藥熔接 (fill/weld process) portion with well-by-well data, stored as a JSON blob
- **Post_Process_Section**: The 貼標/組裝/包裝/裝箱 (labeling/assembly/packaging/boxing) portion, stored as a JSON blob

## Requirements

### Requirement 1: Tabbed Interface Conversion

**User Story:** As a production operator, I want the TuttiPage to have tabs for different functions, so that I can access both the existing 預建線 iframe and the new work order management interface from the same page.

#### Acceptance Criteria

1. WHEN the TuttiPage loads, THE TuttiPage SHALL render a tabbed interface with two tabs: "預建線" and "工單"
2. WHEN the "預建線" tab is selected, THE TuttiPage SHALL display the existing iframe content pointing to `/qc-web/pre-assignment/`
3. WHEN the "工單" tab is selected, THE TuttiPage SHALL display the Work_Order_Tab component with the production record list
4. THE TuttiPage SHALL default to the "預建線" tab on initial load
5. THE TuttiPage SHALL preserve the iframe state when switching between tabs (no reload on tab switch)

### Requirement 2: Remote Database Initialization

**User Story:** As a system administrator, I want to initialize the remote database table via an API endpoint, so that the `tutti_production` table is created on the beadsdb server without manual SSH access.

#### Acceptance Criteria

1. WHEN a POST request is sent to `/api/tutti/production/init-db`, THE Express_API SHALL create the `tutti_production` table in the Remote_DB at `/opt/beadsops/data/panel_production.db`
2. THE Express_API SHALL create the table with columns: id (INTEGER PRIMARY KEY AUTOINCREMENT), lot_no (TEXT NOT NULL), product_name (TEXT), work_order (TEXT NOT NULL), code_a (TEXT), production_quantity (INTEGER), model_pn (TEXT), materials_json (TEXT), fill_weld_json (TEXT), post_process_json (TEXT), status (TEXT DEFAULT 'draft'), created_by (TEXT), created_at (TEXT DEFAULT datetime('now','localtime')), updated_at (TEXT DEFAULT datetime('now','localtime')), remarks (TEXT)
3. IF the SSH_Tunnel connection fails, THEN THE Express_API SHALL return an HTTP 500 response with a descriptive error message
4. IF the table already exists, THEN THE Express_API SHALL return a success response without modifying the existing table

### Requirement 3: Production Record List View

**User Story:** As a production operator, I want to see a list of all existing production records, so that I can quickly find and open a specific work order.

#### Acceptance Criteria

1. WHEN the "工單" tab is displayed, THE Work_Order_Tab SHALL fetch and display all Production_Record entries from the Remote_DB via GET `/api/tutti/production`
2. THE Work_Order_Tab SHALL display records in a table showing: lot_no, work_order, product_name, model_pn, production_quantity, status, and created_at columns
3. THE Work_Order_Tab SHALL display a "新增工單" (New Work Order) button above the record list
4. WHEN a record row is clicked, THE Work_Order_Tab SHALL open that record in the Excel-like editable grid view
5. THE Work_Order_Tab SHALL sort records by created_at in descending order (newest first)
6. IF the API request fails, THEN THE Work_Order_Tab SHALL display an error message to the user

### Requirement 4: Production Record CRUD API

**User Story:** As a production operator, I want to create, read, update, and delete production records through the API, so that data is persisted on the remote database.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/api/tutti/production`, THE Express_API SHALL return all rows from the `tutti_production` table in the Remote_DB as a JSON array
2. WHEN a GET request is sent to `/api/tutti/production/:id`, THE Express_API SHALL return the single Production_Record matching the given id
3. WHEN a POST request is sent to `/api/tutti/production` with valid body data, THE Express_API SHALL insert a new row into the `tutti_production` table and return the created record
4. WHEN a PUT request is sent to `/api/tutti/production/:id` with updated fields, THE Express_API SHALL update the matching row in the `tutti_production` table and set updated_at to the current timestamp
5. WHEN a DELETE request is sent to `/api/tutti/production/:id`, THE Express_API SHALL delete the matching row from the `tutti_production` table
6. IF a required field (lot_no or work_order) is missing in a POST request, THEN THE Express_API SHALL return an HTTP 400 response with a validation error message
7. IF the requested id does not exist, THEN THE Express_API SHALL return an HTTP 404 response
8. THE Express_API SHALL execute all database operations via the SSH_Tunnel using the existing `queryRemoteDb` pattern from the schedule route

### Requirement 5: Excel-like Grid Editor

**User Story:** As a production operator, I want to edit a production record in an Excel-like grid that resembles the OW sheet layout, so that I can fill in process data in a familiar spreadsheet format.

#### Acceptance Criteria

1. WHEN a Production_Record is opened for editing, THE AG_Grid SHALL render a grid layout with four visual sections: header (LOT NO, 工單號碼, 製令數量, Model P/N), Materials_Section (入料), Fill_Weld_Section (填藥熔接), and Post_Process_Section (貼標/組裝/包裝/裝箱)
2. THE AG_Grid SHALL allow inline cell editing for all data fields
3. WHEN a cell value is modified, THE Work_Order_Tab SHALL track the change locally until the user explicitly saves
4. WHEN the user clicks a "儲存" (Save) button, THE Work_Order_Tab SHALL send a PUT request to `/api/tutti/production/:id` with the updated record data
5. THE AG_Grid SHALL display the header section fields (lot_no, work_order, production_quantity, model_pn, code_a, product_name) as editable cells in a fixed top area
6. THE AG_Grid SHALL render the Materials_Section as rows parsed from the materials_json field with fixed row labels for each material type
7. THE AG_Grid SHALL render the Fill_Weld_Section as a well-by-well data grid parsed from the fill_weld_json field
8. THE AG_Grid SHALL render the Post_Process_Section as rows parsed from the post_process_json field with sections for 貼標, 組裝, 包裝, and 裝箱
9. IF the save operation fails, THEN THE Work_Order_Tab SHALL display an error message and retain the unsaved changes locally

### Requirement 6: New Work Order Creation

**User Story:** As a production operator, I want to create a new blank work order, so that I can start recording a new production process.

#### Acceptance Criteria

1. WHEN the "新增工單" button is clicked, THE Work_Order_Tab SHALL display the Excel-like grid editor with empty fields
2. WHEN the user fills in at least lot_no and work_order and clicks "儲存", THE Work_Order_Tab SHALL send a POST request to `/api/tutti/production` to create the record
3. WHEN the record is successfully created, THE Work_Order_Tab SHALL navigate back to the record list and display the new record
4. IF the creation fails due to validation errors, THEN THE Work_Order_Tab SHALL display the specific validation error to the user

### Requirement 7: SSH Tunnel Database Access

**User Story:** As a developer, I want the Express API to access the remote panel_production.db via SSH tunnel, so that the existing infrastructure pattern is reused consistently.

#### Acceptance Criteria

1. THE Express_API SHALL connect to the remote server using SSH configuration: host=54.199.19.240, port=22, username=ec2-user, privateKey from `/home/ubuntu/.ssh/beadsops-api_pem.pem`
2. THE Express_API SHALL execute sqlite3 commands against `/opt/beadsops/data/panel_production.db` on the remote server
3. THE Express_API SHALL use the same `queryRemoteDb` pattern established in the schedule route (ssh2 Client, exec sqlite3 -json)
4. IF the SSH key file does not exist, THEN THE Express_API SHALL return an error indicating the SSH key is not found
5. IF the remote sqlite3 command returns an error, THEN THE Express_API SHALL propagate the error message to the API response

### Requirement 8: Record Status Management

**User Story:** As a production supervisor, I want records to have status tracking (draft/completed/confirmed), so that I can identify which records are finalized.

#### Acceptance Criteria

1. WHEN a new Production_Record is created, THE Express_API SHALL set the status field to 'draft'
2. THE Work_Order_Tab SHALL display the status of each record in the list view with visual differentiation (color or badge)
3. WHEN a record with status 'draft' is opened, THE AG_Grid SHALL allow editing of all fields
4. WHEN a record with status 'confirmed' is opened, THE AG_Grid SHALL display all fields as read-only
