# Implementation Plan: IPQC User Manual Static Website

## Overview

建立 qc-web-ipqc 系統的靜態 HTML 使用說明網站，部署於 `usermanu/` 目錄。實作順序為：專案結構 → CSS 樣式 → HTML 頁面（首頁 + 各章節）→ 工作流程圖 → 截圖自動化 → 部署配置。所有頁面使用相對路徑、響應式設計、純 HTML/CSS 無 JavaScript 依賴。

## Tasks

- [x] 1. Create project directory structure and placeholder files
  - [x] 1.1 Create `usermanu/` directory with subdirectories `css/`, `screenshots/`, `images/`, `scripts/`, `diagrams/`
    - Create all directories under `/home/ubuntu/qc-web-ipqc/usermanu/`
    - Add `.gitkeep` files in `screenshots/` and `images/` to preserve empty directories
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x] 2. Create CSS stylesheet with responsive design
  - [x] 2.1 Create `usermanu/css/style.css` with CSS custom properties, base reset, typography, and layout
    - Implement CSS variables for colors, spacing, and max-width as defined in design
    - Implement base reset and typography styles
    - Implement header, main, footer layout components
    - Implement desktop and mobile navigation styles (hamburger menu via CSS-only checkbox hack)
    - Implement module cards grid for index page
    - Implement section page styles (step lists, screenshots display rules)
    - Implement responsive breakpoints: default (<768px), ≥768px, ≥1024px, ≥1920px
    - Implement screenshot classes: `.screenshot`, `.screenshot--pc` (max 800px), `.screenshot--mobile` (max 375px)
    - Implement 404 error page styles
    - _Requirements: 1.5, 2.5_

  - [ ]* 2.2 Write property test for responsive layout invariant
    - **Property 4: Responsive Layout Invariant**
    - **Validates: Requirements 2.5**

- [x] 3. Create index.html homepage with module cards
  - [x] 3.1 Create `usermanu/index.html` with HTML5 structure, navigation header, and module card grid
    - Use the HTML page template from design document
    - Include site title "IPQC 使用說明" and introductory paragraph
    - Create 5 module cards with name, description, and link to each section page
    - Include responsive navigation with hamburger toggle (CSS-only)
    - No prev/next footer navigation on index page
    - All resource paths must be relative (css/style.css, etc.)
    - _Requirements: 1.2, 1.6, 1.7, 2.1, 2.3_

- [x] 4. Create ipqc-dashboard.html section page
  - [x] 4.1 Create `usermanu/ipqc-dashboard.html` with IPQC Dashboard operation guide
    - Use HTML page template with navigation header and footer
    - Include chapter title, feature overview paragraph
    - Include operation steps for: Dashboard overview, KPI cards, data refresh
    - Include operation steps for: Table 1 (Dried Beads) - view, search, filter
    - Include operation steps for: Table 2 (OD Analysis) - CSV import, OD values, concentration conversion
    - Include data import steps with format requirements
    - Include error handling section for import failures
    - Add screenshot placeholders with proper classes (`.screenshot--pc`)
    - Footer navigation: no prev link (first chapter), next → tutti.html, home → index.html
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 2.3, 2.4_

- [x] 5. Create tutti.html section page
  - [x] 5.1 Create `usermanu/tutti.html` with Tutti Beads Pre Assignment operation guide
    - Use HTML page template with navigation header and footer
    - Include chapter title and feature overview
    - Include import workflow steps: open modal, fill Marker (required), fill optional fields, upload Excel or manual input, execute import, confirm results
    - Include file format requirements (.xlsx/.xls, L1/L2/N1/N3 headers)
    - Include error handling for 3 scenarios: missing Marker, wrong format, no csassign concentration data
    - Add screenshot placeholders for: import modal, fields filled, file uploaded, success list
    - Footer navigation: prev → ipqc-dashboard.html, next → buildline-pc.html, home → index.html
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 2.3, 2.4_

- [x] 6. Create buildline-pc.html and buildline-mobile.html section pages
  - [x] 6.1 Create `usermanu/buildline-pc.html` with PC BuildLine operation guide
    - Use HTML page template with navigation header and footer
    - Include access URL: `https://52-192-28-39.sslip.io/qc-web/pre-assignment/build-lines`
    - Include operation steps: set query conditions (panel_name, analyze_date), execute query, view results, click "建線送 RD"
    - Include success/failure feedback messages description
    - Include workflow diagram placeholder (`images/workflow_buildline_pc.png`)
    - Add screenshot placeholders with `.screenshot--pc` class
    - Footer navigation: prev → tutti.html, next → buildline-mobile.html, home → index.html
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 2.3, 2.4_

  - [x] 6.2 Create `usermanu/buildline-mobile.html` with Mobile BuildLine operation guide
    - Use HTML page template with navigation header and footer
    - Include access URL: `https://52-192-28-39.sslip.io/qc-web/pre-assignment/tutti-scan`
    - Include 6-step scanning flow: machine QR scan, position select, work order QR scan, disk QR scan, data confirm, submit
    - Include each step's purpose, expected input (QR format/options), and success screen change
    - Include comparison section: mobile vs PC differences (input method, flow, use case)
    - Include error handling: QR parse failure, manual input alternative, batch mismatch
    - Include workflow diagram placeholder (`images/workflow_buildline_mobile.png`)
    - Add screenshot placeholders with `.screenshot--mobile` class
    - Footer navigation: prev → buildline-pc.html, next → rd-mobile.html, home → index.html
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 2.3, 2.4_

- [x] 7. Create rd-mobile.html section page
  - [x] 7.1 Create `usermanu/rd-mobile.html` with Skyla RD Mobile operation guide
    - Use HTML page template with navigation header and footer
    - Include access URL: `https://52-192-28-39.sslip.io/qc-web/pre-assignment/rd-mobile`
    - Include task list view and filtering (pending/completed/all)
    - Include Panel group view and Marker task details
    - Include worker ID verification step
    - Include direct write-to-buildline operation
    - Include Curve Fit section: scatter chart, residual chart, data point remove/restore
    - Include parameter adjustment: Shift (-0.5 to 0.5, step 0.001), Rotation (-15° to 15°, step 0.1°), reset
    - Include error case: fewer than 2 valid data points
    - Include workflow diagram placeholder (`images/workflow_rd_mobile.png`)
    - Add screenshot placeholders with `.screenshot--mobile` class
    - Footer navigation: no next link (last chapter), prev → buildline-mobile.html, home → index.html
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 2.3, 2.4_

- [x] 8. Create 404.html error page
  - [x] 8.1 Create `usermanu/404.html` with error message and return-to-home link
    - Include error description text explaining page not found
    - Include clickable link back to `index.html` (relative path)
    - Use consistent styling from style.css
    - Include navigation header for consistency
    - _Requirements: 9.4, 2.6_

- [x] 9. Checkpoint - Verify all HTML pages and CSS
  - Ensure all HTML files are valid HTML5 structure, all relative paths are correct, navigation links form a proper chain. Ask the user if questions arise.

- [x] 10. Create workflow diagram source files and generate PNGs
  - [x] 10.1 Create Mermaid source files for all 4 workflow diagrams
    - Create `usermanu/diagrams/workflow_buildline_pc.md` with BuildLine PC flowchart
    - Create `usermanu/diagrams/workflow_rd_mobile.md` with RD Mobile flowchart
    - Create `usermanu/diagrams/workflow_tutti_import.md` with Tutti Import flowchart
    - Create `usermanu/diagrams/workflow_buildline_mobile.md` with BuildLine Mobile flowchart
    - Use Mermaid flowchart syntax as defined in design document
    - _Requirements: 5.5, 7.7_

  - [x] 10.2 Generate PNG images from Mermaid source files using mmdc CLI
    - Install `@mermaid-js/mermaid-cli` as dev dependency if not present
    - Run `mmdc` commands to generate PNGs at 800px width into `usermanu/images/`
    - Verify all 4 PNG files are generated successfully
    - _Requirements: 1.4, 5.5, 7.7_

- [x] 11. Create Playwright screenshot automation script
  - [x] 11.1 Create `usermanu/scripts/capture-screenshots.ts` with screenshot task registry and capture logic
    - Implement `ScreenshotTask` and `CaptureResult` interfaces as defined in design
    - Implement complete `SCREENSHOT_REGISTRY` with all module tasks (Dashboard, Tutti, BuildLinePC, BuildLineMobile, RdMobile)
    - Implement capture loop: navigate to URL, wait for page load, perform actions, save screenshot
    - Implement error handling: 10s timeout per screenshot, skip on failure, record error
    - Implement summary report output: total, success, failed count, duration
    - Use viewport configurations: PC 1920x1080, BuildLine Mobile 375x812, RD Mobile 390x844
    - Save screenshots to `usermanu/screenshots/` with naming convention `{Module}_{description}_{sequence}.png`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 11.2 Create `usermanu/scripts/playwright.screenshot.config.ts` dedicated Playwright config
    - Configure testDir, timeout (120s), headless mode
    - Configure webServer to start Vite dev server on port 5173
    - Set baseURL to `http://localhost:5173`
    - _Requirements: 8.6_

  - [x] 11.3 Add `manual:screenshots` NPM script to root `package.json`
    - Add script: `"manual:screenshots": "npx playwright test usermanu/scripts/capture-screenshots.ts --config=usermanu/scripts/playwright.screenshot.config.ts"`
    - _Requirements: 8.6_

- [x] 12. Configure Express.js static middleware for deployment
  - [x] 12.1 Add static file serving middleware to `server/index.js` for usermanu directory
    - Add `express.static()` middleware for path `/qc-web/usermanu` pointing to `usermanu/` directory
    - Configure options: `index: 'index.html'`, `extensions: ['html']`, `fallthrough: true`
    - Add 404 fallback route for `/qc-web/usermanu/*` that serves `usermanu/404.html`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Final checkpoint - Verify complete implementation
  - Ensure all HTML pages have correct navigation chain, all relative paths resolve to existing files, Express middleware is configured correctly. Ask the user if questions arise.

  - [ ]* 13.1 Write property test for relative path integrity
    - **Property 1: Relative Path Integrity**
    - **Validates: Requirements 1.6, 1.7**

  - [ ]* 13.2 Write property test for navigation completeness
    - **Property 2: Navigation Completeness**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 13.3 Write property test for file existence consistency
    - **Property 5: File Existence Consistency**
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 13.4 Write property test for page order consistency
    - **Property 6: Page Order Consistency**
    - **Validates: Requirements 2.4**

  - [ ]* 13.5 Write property test for screenshot naming convention
    - **Property 7: Screenshot Naming Convention**
    - **Validates: Requirements 8.3**

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- All HTML pages use relative paths only — no absolute paths or CDN links
- CSS is mobile-first with breakpoints at 768px, 1024px, and 1920px
- Navigation uses CSS-only hamburger menu (no JavaScript dependency)
- Screenshot automation requires the Vite dev server running (handled by Playwright config)
- Workflow diagrams require `@mermaid-js/mermaid-cli` for PNG generation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "12.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "8.1"] },
    { "id": 3, "tasks": ["4.1", "5.1", "6.1", "6.2", "7.1", "10.1"] },
    { "id": 4, "tasks": ["10.2", "11.1", "11.2"] },
    { "id": 5, "tasks": ["11.3"] },
    { "id": 6, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5"] }
  ]
}
```
