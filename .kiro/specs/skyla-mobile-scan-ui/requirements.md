# Requirements Document

## Introduction

Upgrade the QC mobile scan UI from a basic web form to a Skyla brand-feel, app-like scanning task interface. The restyle covers all mobile pages (not just ScanPage) to deliver a consistent Skyla brand experience. The existing scan flow logic, QR parsers, scan verifier, backend API, and data layer remain unchanged — only the frontend presentation layer is modified.

## Glossary

- **Mobile_Scan_UI**: The set of React frontend pages located in the mobile scan directory that operators use on mobile devices to perform QC scanning tasks
- **ScanPage**: The primary mobile page where operators scan QR codes and progress through scan steps
- **Skyla_Brand_Theme**: The visual identity system using Skyla Green (#7FBF3F), Soft Blue (#3BA7D8), light background (#F4FAF6), and organic petal/cell/leaf decorative shapes
- **Step_Progress_Indicator**: A visual component showing the operator's current position within the multi-step scan workflow
- **Mission_Card**: The main content panel on ScanPage that presents the current scan task as an app-like mission or task card
- **CTA_Button**: The primary call-to-action button that operators tap to advance through scan steps
- **Summary_Card**: A card component displayed after a scan step completes, showing the result of that step
- **Hint_Bar**: A fixed bar at the bottom of the screen providing contextual guidance to the operator
- **Position_Grid**: A 2×2 grid of selectable cards used for position selection during the scan flow
- **Review_Card**: A confirmation-style card shown before final submission, summarizing all scanned data
- **Manual_Input_Panel**: An expandable section (collapsed by default) allowing operators to type data manually instead of scanning
- **Safe_Area**: Device-specific padding that prevents content from being obscured by notches, status bars, or home indicators

## Requirements

### Requirement 1: Full-Screen App Layout

**User Story:** As a mobile operator, I want the scan interface to feel like a native app, so that I can focus on my scanning task without browser chrome distractions.

#### Acceptance Criteria

1. THE Mobile_Scan_UI SHALL render in a full-screen layout that occupies 100% of the viewport height and width.
2. THE Mobile_Scan_UI SHALL apply Safe_Area padding on all edges to prevent content from being obscured by device notches, status bars, or home indicators.
3. THE Mobile_Scan_UI SHALL use the Skyla_Brand_Theme background color (#F4FAF6) as the base page background across all mobile pages.
4. THE Mobile_Scan_UI SHALL display decorative petal, cell, or leaf shapes in the background using CSS to reinforce the Skyla brand identity.

### Requirement 2: Skyla Brand Header

**User Story:** As a mobile operator, I want to see a branded header that communicates the mission context, so that I know which task I am performing.

#### Acceptance Criteria

1. THE Mobile_Scan_UI SHALL display a header section at the top of each mobile page with a Skyla brand mission feel.
2. THE header SHALL include a step badge showing the current step number and total steps in the format "Step N of M".
3. THE header SHALL use Skyla Green (#7FBF3F) as the primary accent color for active elements.
4. THE header SHALL use white or light text on colored backgrounds to maintain readable contrast ratios of at least 4.5:1.

### Requirement 3: Step Progress Indicator

**User Story:** As a mobile operator, I want to see my progress through the scan steps, so that I know how much work remains.

#### Acceptance Criteria

1. THE Step_Progress_Indicator SHALL display all steps in the scan workflow as a horizontal sequence of indicators.
2. THE Step_Progress_Indicator SHALL visually distinguish completed steps, the active step, and upcoming steps using distinct colors and styles.
3. WHEN a step is active, THE Step_Progress_Indicator SHALL apply a glow and pulse animation to the active step indicator using Framer Motion.
4. WHEN a step is completed, THE Step_Progress_Indicator SHALL display a checkmark or filled state for that step indicator.

### Requirement 4: Mission Card

**User Story:** As a mobile operator, I want the current scan task presented as a clear mission card, so that I can quickly understand what action is required.

#### Acceptance Criteria

1. THE Mission_Card SHALL be displayed as the central content element on ScanPage with a white (#FFFFFF) background, rounded corners, and a subtle shadow.
2. THE Mission_Card SHALL contain the current task title, instruction text, and the primary CTA_Button.
3. THE Mission_Card SHALL use Skyla_Brand_Theme typography with muted text (#6B7C85) for secondary information.
4. WHEN the scan step changes, THE Mission_Card SHALL animate the transition using a fade and slide effect via Framer Motion.

### Requirement 5: CTA Button with Shimmer

**User Story:** As a mobile operator, I want the main action button to be visually prominent and inviting, so that I can easily identify what to tap next.

#### Acceptance Criteria

1. THE CTA_Button SHALL be displayed as a full-width button with Skyla Green (#7FBF3F) background and white text.
2. THE CTA_Button SHALL apply a shimmer animation using Framer Motion to draw operator attention when the button is actionable.
3. WHEN the CTA_Button is disabled, THE CTA_Button SHALL remove the shimmer animation and reduce opacity to indicate the inactive state.
4. THE CTA_Button SHALL have a minimum tap target size of 48×48 CSS pixels to meet mobile accessibility guidelines.

### Requirement 6: Completed Summary Cards

**User Story:** As a mobile operator, I want to see completed scan results as summary cards, so that I can verify what has been recorded.

#### Acceptance Criteria

1. WHEN a scan step is completed, THE Mobile_Scan_UI SHALL display a Summary_Card showing the result of that step.
2. THE Summary_Card SHALL animate into view using a slide-in animation from the bottom via Framer Motion.
3. THE Summary_Card SHALL display the step label, scanned value, and a success indicator using the Success color (#35A853).
4. THE Summary_Card SHALL use a white background with rounded corners consistent with the Mission_Card styling.

### Requirement 7: Bottom Hint Bar

**User Story:** As a mobile operator, I want contextual hints at the bottom of the screen, so that I receive guidance without leaving the current view.

#### Acceptance Criteria

1. THE Hint_Bar SHALL be fixed to the bottom of the viewport above the Safe_Area padding.
2. THE Hint_Bar SHALL display contextual guidance text relevant to the current scan step.
3. THE Hint_Bar SHALL use muted text (#6B7C85) on a semi-transparent white background to remain visible without distracting from the main content.
4. WHEN the scan step changes, THE Hint_Bar SHALL update its text content to reflect the new step context.

### Requirement 8: Position Selection Grid

**User Story:** As a mobile operator, I want to select a position from a clear grid of options, so that I can quickly choose without scrolling through a list.

#### Acceptance Criteria

1. THE Position_Grid SHALL display position options as a 2×2 grid of selectable cards.
2. WHEN an operator taps a position card, THE Position_Grid SHALL highlight the selected card using Skyla Green (#7FBF3F) border and background tint.
3. THE Position_Grid cards SHALL have a minimum tap target size of 48×48 CSS pixels.
4. THE Position_Grid SHALL use Framer Motion scale animation on tap to provide tactile feedback.

### Requirement 9: Review Card

**User Story:** As a mobile operator, I want to review all scanned data before final submission, so that I can catch errors before committing.

#### Acceptance Criteria

1. THE Review_Card SHALL display all scanned data fields in a structured, formal confirmation layout.
2. THE Review_Card SHALL use a white background with a distinct top border in Skyla Green (#7FBF3F) to differentiate it from regular Summary_Cards.
3. THE Review_Card SHALL list each data field with its label and value in a readable key-value format.
4. THE Review_Card SHALL include a confirm button and a back/edit option for the operator.

### Requirement 10: Enhanced Success and Error States

**User Story:** As a mobile operator, I want clear visual feedback for success and error outcomes, so that I immediately know whether a scan succeeded or failed.

#### Acceptance Criteria

1. WHEN a scan succeeds, THE Mobile_Scan_UI SHALL display a success state using the Success color (#35A853) with an animated checkmark icon via Framer Motion.
2. WHEN a scan fails or an error occurs, THE Mobile_Scan_UI SHALL display an error state using the Error color (#E05252) with a clear error message.
3. WHEN a warning condition is detected, THE Mobile_Scan_UI SHALL display a warning state using the Warning color (#F5B942).
4. THE success and error state animations SHALL complete within 400ms to provide immediate feedback without delaying the operator.

### Requirement 11: Manual Input Panel

**User Story:** As a mobile operator, I want the option to manually enter data when scanning is not possible, so that I can continue my task without being blocked.

#### Acceptance Criteria

1. THE Manual_Input_Panel SHALL be collapsed and hidden by default on ScanPage.
2. WHEN the operator taps the manual input toggle, THE Manual_Input_Panel SHALL expand with a slide-down animation via Framer Motion.
3. THE Manual_Input_Panel SHALL provide a text input field and a submit button for manual data entry.
4. THE Manual_Input_Panel SHALL use Soft Blue (#3BA7D8) as its accent color to visually distinguish it from the primary scan flow.

### Requirement 12: Consistent Styling Across All Mobile Pages

**User Story:** As a mobile operator, I want all mobile pages to share the same Skyla brand look and feel, so that the experience feels cohesive and professional.

#### Acceptance Criteria

1. THE Mobile_Scan_UI SHALL apply the Skyla_Brand_Theme consistently across all mobile pages including ScanPage, position selection, review, and result pages.
2. THE Mobile_Scan_UI SHALL use plain CSS with manually authored Skyla brand styles for all visual presentation.
3. THE Mobile_Scan_UI SHALL use the defined color palette consistently: Skyla Green (#7FBF3F/#8BC53F), Soft Blue (#3BA7D8/#63C7E8), Background (#F4FAF6), Card (#FFFFFF), Muted Text (#6B7C85), Success (#35A853), Warning (#F5B942), Error (#E05252).
4. THE Mobile_Scan_UI SHALL use Framer Motion as the sole animation library for all motion effects.

### Requirement 13: Lightweight Animation Performance

**User Story:** As a mobile operator, I want animations to be smooth and non-intrusive, so that the interface feels responsive on mobile devices without draining battery.

#### Acceptance Criteria

1. THE Mobile_Scan_UI SHALL limit all animations to CSS transform and opacity properties to enable GPU-accelerated rendering.
2. THE Mobile_Scan_UI SHALL keep individual animation durations at or below 400ms unless the animation is a continuous ambient effect.
3. THE Mobile_Scan_UI SHALL avoid simultaneous animations on more than three elements to prevent frame drops on mobile devices.
4. THE Mobile_Scan_UI SHALL use Framer Motion's layout animation capabilities for element reordering rather than manual position calculations.

### Requirement 14: Preservation of Existing Logic

**User Story:** As a developer, I want the UI restyle to leave all business logic, parsers, and data flow untouched, so that the upgrade carries zero regression risk.

#### Acceptance Criteria

1. THE Mobile_Scan_UI SHALL preserve the existing scan flow sequence without adding, removing, or reordering steps.
2. THE Mobile_Scan_UI SHALL not modify qbiQrParser.ts, workOrderQrParser.ts, or tuttiScanVerifier.ts files.
3. THE Mobile_Scan_UI SHALL not modify any backend API endpoints or RDS schema.
4. THE Mobile_Scan_UI SHALL not modify TemplateManagementPage.tsx or build-lines page data flow.
5. THE Mobile_Scan_UI SHALL continue to use html5-qrcode for QR code scanning without replacing or wrapping the library.
