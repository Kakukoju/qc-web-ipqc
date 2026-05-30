# Implementation Plan: Skyla Mobile Scan UI

## Overview

Restyle the QC mobile scan UI into a Skyla-branded, app-like experience by creating a new CSS architecture, 11 Skyla components, and integrating them into all 10 existing mobile pages. Framer Motion handles animations; existing business logic, parsers, and data flow remain untouched.

## Tasks

- [x] 1. Create CSS architecture and design tokens
  - [x] 1.1 Create `mobile/styles/skyla-theme.css` with all CSS custom properties
    - Define brand colors (--skyla-green, --skyla-blue, etc.), semantic colors, spacing tokens, safe-area env() references, border-radius, shadow, and typography variables exactly as specified in the design document
    - _Requirements: 1.3, 12.2, 12.3_

  - [x] 1.2 Create `mobile/styles/skyla-animations.css` with keyframe definitions
    - Define @keyframes for skyla-shimmer, skyla-pulse, and skyla-float
    - Add `prefers-reduced-motion` media query that disables all keyframe animations
    - _Requirements: 5.2, 13.1, 1.4_

  - [x] 1.3 Create `mobile/styles/skyla-components.css` with all component styles
    - Implement BEM-like classes with `skyla-` prefix for: app-shell, header, progress, mission-card, cta-btn, summary-card, hint-bar, position-grid, review-card, manual-panel, status
    - Include background decoration pseudo-elements (::before, ::after) on .skyla-app-shell with float animation
    - Ensure CTA button minimum 48×48px tap target, position grid cards minimum 48×48px
    - Include `prefers-reduced-motion` overrides for CSS animations on decorations and shimmer
    - _Requirements: 1.1, 1.2, 1.4, 4.1, 5.1, 5.4, 6.4, 7.1, 7.3, 8.1, 8.3, 9.2, 12.1_

  - [ ]* 1.4 Write property test for color palette completeness (Property 9)
    - **Property 9: Color palette definition completeness**
    - Verify all color tokens (green, blue, bg, card, muted, success, warning, error) are defined with correct hex values
    - **Validates: Requirements 12.3**

- [x] 2. Create core Skyla components
  - [x] 2.1 Create `mobile/components/skyla/motion-config.ts`
    - Export MOTION constant with duration (fast: 0.2, normal: 0.3, emphasis: 0.4), easing arrays, and spring config as specified in design
    - _Requirements: 13.1, 13.2_

  - [ ]* 2.2 Write property test for animation duration bounds (Property 8)
    - **Property 8: Animation durations do not exceed 400ms**
    - For any non-ambient transition config in MOTION, verify duration ≤ 0.4s
    - **Validates: Requirements 10.4, 13.2**

  - [x] 2.3 Create `mobile/components/skyla/BrandHeader.tsx`
    - Implement BrandHeaderProps interface (title?, currentStep, totalSteps)
    - Render header with optional title and step badge "Step N of M"
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.4 Create `mobile/components/skyla/StepProgress.tsx`
    - Implement StepProgressProps interface (currentStep, totalSteps, completedSteps, labels)
    - Render N step indicators with completed/active/default states
    - Use Framer Motion scale animation on active step; respect prefers-reduced-motion
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.5 Write property test for StepProgress visual states (Property 1)
    - **Property 1: Step progress renders correct visual states**
    - For any valid step config, verify correct number of indicators, checkmarks on completed, active class on current
    - **Validates: Requirements 2.2, 3.1, 3.2, 3.4**

  - [x] 2.6 Create `mobile/components/skyla/HintBar.tsx`
    - Implement HintBarProps interface (text)
    - Render fixed-bottom hint with fade-in animation via Framer Motion
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 2.7 Write property test for HintBar text display (Property 4)
    - **Property 4: Hint bar reflects current step context**
    - For any hint message string, verify HintBar renders exactly that text
    - **Validates: Requirements 7.2, 7.4**

  - [x] 2.8 Create `mobile/components/skyla/StatusIndicator.tsx`
    - Implement StatusIndicatorProps interface (type: success|error|warning, message)
    - Map type to correct color variable and icon (✓, ✕, ⚠)
    - Animate entry with scale via Framer Motion
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 2.9 Write property test for StatusIndicator type-to-color mapping (Property 7)
    - **Property 7: Status indicator maps outcome type to correct color**
    - For any status type, verify correct CSS class and message text rendered
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create interactive Skyla components
  - [x] 4.1 Create `mobile/components/skyla/MissionCard.tsx`
    - Implement MissionCardProps interface (title, instruction, children?)
    - Animate entry/exit with fade+slide via Framer Motion AnimatePresence
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.2 Write property test for MissionCard content rendering (Property 10)
    - **Property 10: Mission card renders task content**
    - For any title and instruction string, verify both appear in rendered output
    - **Validates: Requirements 4.2**

  - [x] 4.3 Create `mobile/components/skyla/CTAButton.tsx`
    - Implement CTAButtonProps interface (label, onClick, disabled?)
    - Render shimmer span when enabled; remove shimmer and reduce opacity when disabled
    - Use Framer Motion whileTap scale; ensure 48×48px minimum tap target
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 4.4 Write property test for CTA button shimmer/disabled correlation (Property 2)
    - **Property 2: CTA button shimmer correlates with enabled state**
    - For any disabled prop value, verify shimmer present iff disabled=false
    - **Validates: Requirements 5.2, 5.3**

  - [x] 4.5 Create `mobile/components/skyla/SummaryCard.tsx`
    - Implement SummaryCardProps interface (label, value, stepNumber)
    - Render step header with checkmark, label, and value
    - Animate entry with slide-up via Framer Motion
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 4.6 Write property test for SummaryCard content display (Property 3)
    - **Property 3: Summary card displays complete step result**
    - For any label and value string, verify both rendered with success indicator
    - **Validates: Requirements 6.1, 6.3**

  - [x] 4.7 Create `mobile/components/skyla/PositionGrid.tsx`
    - Implement PositionGridProps interface (positions, selectedId, onSelect)
    - Render 2×2 grid; apply selected class to matching card only
    - Use Framer Motion whileTap scale; ensure 48×48px minimum tap target
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 4.8 Write property test for PositionGrid selection highlighting (Property 5)
    - **Property 5: Position grid selection highlights correct card**
    - For any set of positions and selected ID, verify only matching card has selected class
    - **Validates: Requirements 8.1, 8.2**

  - [x] 4.9 Create `mobile/components/skyla/ReviewCard.tsx`
    - Implement ReviewCardProps interface (fields, onConfirm, onBack)
    - Render all fields as label-value rows; include confirm CTA and back button
    - Animate entry with scale via Framer Motion
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 4.10 Write property test for ReviewCard field rendering (Property 6)
    - **Property 6: Review card renders all data fields**
    - For any array of fields, verify every label and value appears in output
    - **Validates: Requirements 9.1, 9.3**

  - [x] 4.11 Create `mobile/components/skyla/ManualInputPanel.tsx`
    - Implement ManualInputPanelProps interface (onSubmit, placeholder?)
    - Start collapsed; expand/collapse with Framer Motion AnimatePresence height animation
    - Include text input and submit button; use Soft Blue accent
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create AppShell and integrate into pages
  - [x] 6.1 Create `mobile/components/skyla/AppShell.tsx`
    - Implement AppShellProps interface (children, currentStep, totalSteps, completedSteps, stepLabels, hintText?, title?)
    - Compose BrandHeader, StepProgress, main content slot, and HintBar
    - Apply .skyla-app-shell class with full-screen flex layout and background decorations
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 12.1_

  - [ ] 6.2 Update `mobile/App.tsx` to import CSS files and add AnimatePresence
    - Import skyla-theme.css, skyla-animations.css, skyla-components.css
    - Wrap Routes in AnimatePresence mode="wait" with location key
    - _Requirements: 12.1, 12.4, 4.4_

  - [ ] 6.3 Wrap `mobile/ScanPage.tsx` in AppShell
    - Add AppShell wrapper with title="QC Scan Mission", step progress enabled, hint bar enabled
    - Replace inline markup with MissionCard, CTAButton, SummaryCard, ManualInputPanel, StatusIndicator
    - Preserve all existing scan flow logic, state, and parser calls unchanged
    - _Requirements: 1.1, 4.1, 4.2, 5.1, 6.1, 7.2, 11.1, 14.1, 14.2_

  - [ ] 6.4 Wrap `mobile/FlowSelectionPage.tsx` in AppShell
    - Add AppShell wrapper with title="Select Flow", no step progress, hint bar enabled
    - _Requirements: 12.1, 14.1_

  - [ ] 6.5 Wrap `mobile/WorkOrderFlowPage.tsx` in AppShell
    - Add AppShell wrapper with title="Work Order", step progress enabled, hint bar enabled
    - _Requirements: 12.1, 14.1_

  - [ ] 6.6 Wrap `mobile/SlotSelectionPage.tsx` in AppShell
    - Add AppShell wrapper with title="Select Slot", no step progress, hint bar enabled
    - Use PositionGrid component for slot selection
    - _Requirements: 8.1, 12.1, 14.1_

  - [ ] 6.7 Wrap `mobile/CustomFlowPage.tsx` in AppShell
    - Add AppShell wrapper with title="Custom Scan", step progress enabled, hint bar enabled
    - _Requirements: 12.1, 14.1_

  - [ ] 6.8 Wrap `mobile/DiscLayoutPage.tsx` in AppShell
    - Add AppShell wrapper with title="Disc Layout", no step progress, no hint bar
    - _Requirements: 12.1, 14.1_

  - [ ] 6.9 Wrap `mobile/InspectionProgressPage.tsx` in AppShell
    - Add AppShell wrapper with title="Inspection", step progress enabled, hint bar enabled
    - _Requirements: 12.1, 14.1_

  - [ ] 6.10 Wrap `mobile/InspectionResultPage.tsx` in AppShell
    - Add AppShell wrapper with title="Results", no step progress, no hint bar
    - _Requirements: 12.1, 14.1_

  - [ ] 6.11 Wrap `mobile/CurveFitPage.tsx` in AppShell
    - Add AppShell wrapper with title="Curve Fit", no step progress, no hint bar
    - _Requirements: 12.1, 14.1_

  - [ ] 6.12 Wrap `mobile/LoginPage.tsx` in AppShell
    - Add AppShell wrapper with title="Skyla QC", no step progress, no hint bar
    - _Requirements: 12.1, 14.1_

- [x] 7. Final verification
  - [x] 7.1 Verify build passes with `tsc -b && vite build`
    - Ensure no TypeScript errors and Vite production build succeeds
    - Confirm no modifications to qbiQrParser.ts, workOrderQrParser.ts, tuttiScanVerifier.ts, backend API, RDS schema, TemplateManagementPage.tsx, or build-lines page data flow
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x]* 7.2 Run full test suite with `vitest --run`
    - Ensure all property tests and unit tests pass
    - _Requirements: 13.2, 12.3_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Framer Motion is already installed in package.json — no install step needed
- fast-check is already a devDependency — no install step needed
- DO NOT modify: qbiQrParser.ts, workOrderQrParser.ts, tuttiScanVerifier.ts, backend API, RDS schema, TemplateManagementPage.tsx, build-lines page data flow

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.2", "2.3", "2.6", "2.8"] },
    { "id": 2, "tasks": ["2.4", "2.5", "2.7", "2.9"] },
    { "id": 3, "tasks": ["4.1", "4.3", "4.5", "4.7", "4.9", "4.11"] },
    { "id": 4, "tasks": ["4.2", "4.4", "4.6", "4.8", "4.10"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12"] },
    { "id": 8, "tasks": ["7.1", "7.2"] }
  ]
}
```
