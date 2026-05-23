# Requirements Document

## Introduction

QC-RD Build Line System（QC-RD 建線系統）是一個雙角色 Web 系統，用於 QC 人員建立預建線測試數據並提交給 RD 審核。系統包含 QC Web（建線工單掃描、測試數據記錄、建線管理）和 RD Web（審核待辦清單、曲線擬合、審核決策）。兩個 Web 共用同一後端 API，透過角色區分存取權限。系統整合至現有 qc-web-ipqc 專案中，作為新模組運行。

## Glossary

- **Build_Line_System**: 建線系統，管理 QC 建線測試與 RD 審核的完整流程
- **QC_Web**: QC 人員使用的前端介面，負責建線工單掃描、測試執行、數據提交
- **RD_Web**: RD 人員使用的前端介面，負責審核待辦、曲線擬合、審核決策
- **Build_Line_Task**: 建線任務，由工單與機台組合產生的測試任務單元
- **Work_Order**: 建線工單，包含 bead lot、marker、生產批次等資訊的 QR Code 載體
- **Machine**: 建線機台（如 Tutti），具有多個試劑位置（position）
- **Position**: 機台上的試劑位置，QC 選擇後執行測試
- **Bead_Lot**: 珠子批號，建線測試的主要追蹤單位
- **Marker**: 標記物名稱，與 bead lot 組合構成建線管理的核心識別
- **QR_Scanner**: QR Code 掃描模組，支援相機掃描與手動輸入兩種模式
- **Curve_Fitting_Service**: 曲線擬合服務，獨立模組負責數學模型計算
- **Review_Task**: RD 審核任務，由 QC 提交建線數據時自動建立
- **Audit_Log**: 稽核日誌，記錄所有狀態變更的歷史紀錄
- **API_Response**: 統一 API 回應格式 `{"ok": true, "data": {}, "error": null, "_meta": {}}`

## Requirements

### Requirement 1: QR Code Scanning Module

**User Story:** As a QC operator, I want to scan QR codes via camera or manual input, so that I can quickly identify work orders and machines without manual data entry errors.

#### Acceptance Criteria

1. WHEN a QR code is presented to the camera, THE QR_Scanner SHALL decode the QR content and return the parsed data within 2 seconds
2. WHEN the camera is unavailable or scanning fails, THE QR_Scanner SHALL provide a manual text input field for the QR code content
3. THE QR_Scanner SHALL parse QR code content using an independent parsing module that extracts work order ID, machine ID, and metadata fields
4. IF the QR code content does not match any known format, THEN THE QR_Scanner SHALL display a descriptive error message indicating the expected format
5. WHEN a valid work order QR code is scanned, THE QR_Scanner SHALL extract bead lot, marker, production batch, and work order number from the encoded content

### Requirement 2: Build Line Task Creation and Retrieval

**User Story:** As a QC operator, I want the system to automatically retrieve or create a build line task when I scan a work order and machine, so that I can start testing immediately.

#### Acceptance Criteria

1. WHEN a valid work order QR and machine QR are both scanned, THE Build_Line_System SHALL retrieve the existing Build_Line_Task or create a new one if none exists
2. WHEN a new Build_Line_Task is created, THE Build_Line_System SHALL set the initial status to "draft" and record the creation timestamp
3. THE Build_Line_System SHALL associate each Build_Line_Task with exactly one Work_Order and one Machine combination
4. WHEN a Build_Line_Task is retrieved, THE Build_Line_System SHALL display the current status, associated bead lot, marker, and test history
5. IF the Work_Order or Machine data is invalid, THEN THE Build_Line_System SHALL reject the task creation and return a specific error code

### Requirement 3: Machine Position Selection and Test Execution

**User Story:** As a QC operator, I want to select a reagent position on the machine and execute tests, so that I can record test data for specific positions.

#### Acceptance Criteria

1. WHEN a Build_Line_Task is active, THE QC_Web SHALL display all available positions for the selected Machine (e.g., Tutti machine positions)
2. WHEN a QC operator selects a position, THE Build_Line_System SHALL validate that the position is not already occupied by another active test
3. WHEN a test is executed, THE Build_Line_System SHALL record the test data including OD values, timestamp, operator ID, position, and machine ID
4. WHEN test data is recorded, THE Build_Line_System SHALL update the Build_Line_Task status from "draft" to "testing"
5. THE Build_Line_System SHALL allow multiple test executions per Build_Line_Task to accumulate data points

### Requirement 4: Build Line Management and Status Tracking

**User Story:** As a QC operator, I want to view and manage all build line tasks with their statuses, so that I can track progress and decide when to submit data for RD review.

#### Acceptance Criteria

1. THE QC_Web SHALL display a management page listing all Build_Line_Tasks with columns for bead lot, marker, status, test count, last test date, and assigned machine
2. THE QC_Web SHALL support filtering Build_Line_Tasks by status: draft, testing, qc_completed, pending_rd_review, rd_reviewing, rd_approved, rd_rejected
3. WHEN a QC operator views a Build_Line_Task, THE QC_Web SHALL indicate whether sufficient test data points exist for submission (minimum data point threshold)
4. WHEN a QC operator marks a Build_Line_Task as complete, THE Build_Line_System SHALL change the status from "testing" to "qc_completed"
5. THE Build_Line_System SHALL prevent status regression (e.g., a "qc_completed" task cannot return to "draft")

### Requirement 5: QC Submission to RD Review

**User Story:** As a QC operator, I want to submit completed build line data to RD for review, so that RD can perform curve fitting and approve the build line.

#### Acceptance Criteria

1. WHEN a QC operator submits a Build_Line_Task for review, THE Build_Line_System SHALL change the status from "qc_completed" to "pending_rd_review"
2. WHEN a Build_Line_Task is submitted, THE Build_Line_System SHALL create a Review_Task visible to RD_Web
3. WHILE a Build_Line_Task status is "draft" or "testing", THE QC_Web SHALL prevent submission to RD
4. WHEN a submission occurs, THE Build_Line_System SHALL record the submission timestamp, submitting operator, and snapshot of test data in the Audit_Log
5. THE Build_Line_System SHALL make the test data visible to RD_Web only after successful submission (not before)

### Requirement 6: RD Review Todo List and Task Management

**User Story:** As an RD engineer, I want to see a list of pending review tasks from QC, so that I can prioritize and manage my review workload.

#### Acceptance Criteria

1. THE RD_Web SHALL display a todo list page showing all Review_Tasks with columns for bead lot, marker, work order, QC test date, machine, position, data point count, and status
2. THE RD_Web SHALL support filtering Review_Tasks by status: pending_rd_review, rd_reviewing, rd_approved, rd_rejected
3. THE RD_Web SHALL support searching Review_Tasks by marker name and bead lot number
4. THE RD_Web SHALL support filtering Review_Tasks by date range (QC submission date)
5. WHEN an RD engineer opens a Review_Task, THE Build_Line_System SHALL change the status from "pending_rd_review" to "rd_reviewing"
6. THE RD_Web SHALL display a notification indicator showing the count of pending review tasks

### Requirement 7: Curve Fitting Computation

**User Story:** As an RD engineer, I want the system to perform curve fitting on QC test data, so that I can evaluate the quality of the build line calibration.

#### Acceptance Criteria

1. WHEN an RD engineer requests curve fitting, THE Curve_Fitting_Service SHALL accept the test data points and a selected model type as input
2. THE Curve_Fitting_Service SHALL support at minimum linear (y=ax+b) and quadratic (y=ax²+bx+c) curve models
3. WHEN curve fitting is computed, THE Curve_Fitting_Service SHALL return the fitted parameters, R² value, residuals for each data point, and per-point error values
4. THE Curve_Fitting_Service SHALL operate as an independent service module to allow future model expansion without modifying the core system
5. IF the input data has fewer than the minimum required points for the selected model, THEN THE Curve_Fitting_Service SHALL return an error indicating insufficient data

### Requirement 8: Curve Fitting Visualization

**User Story:** As an RD engineer, I want to see the curve fitting results displayed as a chart, so that I can visually assess the fit quality before making a review decision.

#### Acceptance Criteria

1. WHEN curve fitting results are available, THE RD_Web SHALL display a chart showing raw data points and the fitted curve line
2. THE RD_Web SHALL display the fitted equation, R² value, and residual statistics alongside the chart
3. THE RD_Web SHALL highlight data points with high error values (exceeding a configurable threshold) in a distinct color
4. WHEN the RD engineer selects a different curve model, THE RD_Web SHALL recompute and redisplay the fitting results
5. THE RD_Web SHALL display per-point error values in a data table below the chart

### Requirement 9: RD Review Decision and Notification

**User Story:** As an RD engineer, I want to approve, reject, or request additional testing for a build line, so that QC receives clear feedback on the build line quality.

#### Acceptance Criteria

1. WHEN an RD engineer approves a Review_Task, THE Build_Line_System SHALL change the Build_Line_Task status to "rd_approved" and record the approval in the Audit_Log
2. WHEN an RD engineer rejects a Review_Task, THE Build_Line_System SHALL require a rejection reason text and change the status to "rd_rejected"
3. WHEN a Review_Task is rejected, THE Build_Line_System SHALL make the rejection reason visible to QC operators on the QC_Web
4. WHEN an RD engineer requests additional testing, THE Build_Line_System SHALL change the status back to "testing" and notify QC
5. WHEN a review decision is made, THE Build_Line_System SHALL write the curve fitting results (parameters, R², model type) back to the Build_Line_Task record
6. THE Build_Line_System SHALL notify QC_Web of the review result through a status change visible on the management page

### Requirement 10: Audit Logging

**User Story:** As a system administrator, I want all status changes to be logged with full context, so that the complete history of each build line task is traceable.

#### Acceptance Criteria

1. WHEN any Build_Line_Task status changes, THE Build_Line_System SHALL create an Audit_Log entry with the previous status, new status, timestamp, operator ID, and action description
2. THE Build_Line_System SHALL record audit entries for: task creation, test execution, QC completion, submission to RD, RD review start, approval, rejection, and additional testing requests
3. THE Audit_Log SHALL be append-only and entries cannot be modified or deleted
4. WHEN a user views a Build_Line_Task detail page, THE Build_Line_System SHALL display the complete audit history in chronological order

### Requirement 11: Unified API Response Format

**User Story:** As a frontend developer, I want all API endpoints to return a consistent response format, so that error handling and data parsing logic is uniform across the application.

#### Acceptance Criteria

1. THE Build_Line_System SHALL return all API responses in the format: `{"ok": boolean, "data": object|array|null, "error": string|null, "_meta": object}`
2. WHEN an API request succeeds, THE Build_Line_System SHALL return `ok: true` with the result in the `data` field and `error: null`
3. WHEN an API request fails, THE Build_Line_System SHALL return `ok: false` with `data: null` and a descriptive error message in the `error` field
4. THE Build_Line_System SHALL include pagination metadata in the `_meta` field for list endpoints (total count, page, page size)
5. THE Build_Line_System SHALL use standard HTTP status codes: 200 for success, 400 for validation errors, 404 for not found, 500 for server errors

### Requirement 12: Role-Based Access Control

**User Story:** As a system administrator, I want QC and RD to have separate access permissions, so that each role can only perform actions appropriate to their responsibilities.

#### Acceptance Criteria

1. THE Build_Line_System SHALL authenticate users and assign either "qc" or "rd" role
2. WHILE a user has the "qc" role, THE Build_Line_System SHALL allow access to QC_Web features (scanning, testing, submission) and deny access to RD review actions
3. WHILE a user has the "rd" role, THE Build_Line_System SHALL allow access to RD_Web features (review, curve fitting, approval) and deny access to QC submission actions
4. IF an unauthorized role attempts a restricted action, THEN THE Build_Line_System SHALL return a 403 error with a descriptive message
5. THE Build_Line_System SHALL share a single backend API with role-based middleware determining access permissions

### Requirement 13: Data Isolation Before Submission

**User Story:** As a QC operator, I want my in-progress test data to be invisible to RD until I explicitly submit it, so that incomplete data does not cause confusion.

#### Acceptance Criteria

1. WHILE a Build_Line_Task status is "draft", "testing", or "qc_completed", THE Build_Line_System SHALL exclude the task from RD_Web queries
2. WHEN a Build_Line_Task transitions to "pending_rd_review", THE Build_Line_System SHALL include the task in RD_Web query results
3. THE Build_Line_System SHALL enforce data isolation at the API layer, not solely at the frontend layer
4. IF an RD user attempts to access a task that has not been submitted, THEN THE Build_Line_System SHALL return a 404 response

