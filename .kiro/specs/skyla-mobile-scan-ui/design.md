# Design Document: Skyla Mobile Scan UI

## Overview

This document describes the architecture and component design for restyling the QC mobile scan UI into a Skyla-branded, app-like experience. The design introduces a new component library, CSS architecture, and Framer Motion animation patterns while preserving all existing business logic, parsers, and data flow.

## Architecture

The restyle follows a **shell + slot** architecture. A new `AppShell` component wraps each existing page, providing the consistent layout structure (header, progress bar, main content area, hint bar). Individual pages inject their content into the shell's main slot. New UI primitives (MissionCard, SummaryCard, CTAButton, etc.) replace inline markup but delegate all logic to the existing page components.

```
┌─────────────────────────────────┐
│         BrandHeader             │  ← fixed top
├─────────────────────────────────┤
│       StepProgress              │  ← below header
├─────────────────────────────────┤
│                                 │
│        Main Content Slot        │  ← flex-1, scrollable
│   (MissionCard / PositionGrid   │
│    / ReviewCard / Results)       │
│                                 │
├─────────────────────────────────┤
│          HintBar                │  ← fixed bottom
└─────────────────────────────────┘
```

## Technology Stack

- **React 18** with TypeScript
- **react-router-dom 6** for page routing
- **html5-qrcode** for QR scanning (unchanged)
- **Framer Motion** for all animations
- **Vite 6** build tooling
- **Plain CSS** with CSS custom properties (no Tailwind for mobile pages)

## CSS Architecture

### File Structure

```
mobile/
├── styles/
│   ├── skyla-theme.css          # CSS custom properties (colors, spacing, typography)
│   ├── skyla-animations.css     # @keyframes for CSS-only ambient effects
│   └── skyla-components.css     # Component-level styles
```

### skyla-theme.css — Design Tokens

```css
:root {
  /* Brand Colors */
  --skyla-green: #7FBF3F;
  --skyla-green-alt: #8BC53F;
  --skyla-blue: #3BA7D8;
  --skyla-blue-light: #63C7E8;

  /* Semantic Colors */
  --skyla-bg: #F4FAF6;
  --skyla-card: #FFFFFF;
  --skyla-text-muted: #6B7C85;
  --skyla-text-primary: #1A2E1A;
  --skyla-success: #35A853;
  --skyla-warning: #F5B942;
  --skyla-error: #E05252;

  /* Spacing */
  --skyla-safe-top: env(safe-area-inset-top, 0px);
  --skyla-safe-bottom: env(safe-area-inset-bottom, 0px);
  --skyla-safe-left: env(safe-area-inset-left, 0px);
  --skyla-safe-right: env(safe-area-inset-right, 0px);
  --skyla-radius: 16px;
  --skyla-radius-sm: 10px;
  --skyla-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);

  /* Typography */
  --skyla-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --skyla-font-size-lg: 1.25rem;
  --skyla-font-size-md: 1rem;
  --skyla-font-size-sm: 0.875rem;
  --skyla-font-size-xs: 0.75rem;
}
```

### skyla-animations.css — Keyframes

```css
/* Shimmer sweep for CTA button */
@keyframes skyla-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}

/* Ambient pulse for active step indicator */
@keyframes skyla-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.8; }
}

/* Decorative floating for background shapes */
@keyframes skyla-float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-8px) rotate(3deg); }
}
```

### skyla-components.css — Component Styles

Component styles use BEM-like naming with a `skyla-` prefix to avoid collisions with existing styles:

```css
.skyla-app-shell { ... }
.skyla-header { ... }
.skyla-header__badge { ... }
.skyla-progress { ... }
.skyla-progress__step { ... }
.skyla-progress__step--active { ... }
.skyla-progress__step--completed { ... }
.skyla-mission-card { ... }
.skyla-cta-btn { ... }
.skyla-cta-btn--disabled { ... }
.skyla-summary-card { ... }
.skyla-hint-bar { ... }
.skyla-position-grid { ... }
.skyla-position-grid__card { ... }
.skyla-position-grid__card--selected { ... }
.skyla-review-card { ... }
.skyla-manual-panel { ... }
```

## Components and Interfaces

### Component Tree

```
mobile/components/skyla/
├── AppShell.tsx              # Full-screen layout wrapper
├── BrandHeader.tsx           # Top header with step badge
├── StepProgress.tsx          # Horizontal step indicator
├── MissionCard.tsx           # Current task card
├── SummaryCard.tsx           # Completed step result card
├── CTAButton.tsx             # Primary action button with shimmer
├── HintBar.tsx               # Bottom contextual hint
├── PositionGrid.tsx          # 2×2 position selection grid
├── ReviewCard.tsx            # Pre-submission data review
├── ManualInputPanel.tsx      # Expandable manual entry
└── StatusIndicator.tsx       # Success/error/warning feedback
```

### AppShell

The root layout component that wraps every mobile page.

```tsx
interface AppShellProps {
  children: React.ReactNode;
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  stepLabels: string[];
  hintText?: string;
  title?: string;
}

export function AppShell({
  children,
  currentStep,
  totalSteps,
  completedSteps,
  stepLabels,
  hintText,
  title,
}: AppShellProps) {
  return (
    <div className="skyla-app-shell">
      <BrandHeader title={title} currentStep={currentStep} totalSteps={totalSteps} />
      <StepProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        completedSteps={completedSteps}
        labels={stepLabels}
      />
      <main className="skyla-app-shell__content">
        {children}
      </main>
      {hintText && <HintBar text={hintText} />}
    </div>
  );
}
```

**CSS Layout:**
```css
.skyla-app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100vw;
  background: var(--skyla-bg);
  padding-top: var(--skyla-safe-top);
  padding-bottom: var(--skyla-safe-bottom);
  padding-left: var(--skyla-safe-left);
  padding-right: var(--skyla-safe-right);
  overflow: hidden;
  position: relative;
  font-family: var(--skyla-font);
}

.skyla-app-shell__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
}
```

### BrandHeader

```tsx
interface BrandHeaderProps {
  title?: string;
  currentStep: number;
  totalSteps: number;
}

export function BrandHeader({ title, currentStep, totalSteps }: BrandHeaderProps) {
  return (
    <header className="skyla-header">
      {title && <h1 className="skyla-header__title">{title}</h1>}
      <span className="skyla-header__badge">
        Step {currentStep} of {totalSteps}
      </span>
    </header>
  );
}
```

### StepProgress

```tsx
interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  labels: string[];
}

export function StepProgress({ currentStep, totalSteps, completedSteps, labels }: StepProgressProps) {
  return (
    <div className="skyla-progress">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isCompleted = completedSteps.includes(stepNum);
        const isActive = stepNum === currentStep;

        return (
          <motion.div
            key={stepNum}
            className={`skyla-progress__step ${
              isCompleted ? 'skyla-progress__step--completed' :
              isActive ? 'skyla-progress__step--active' : ''
            }`}
            animate={isActive ? { scale: [1, 1.1, 1] } : {}}
            transition={isActive ? { repeat: Infinity, duration: 2 } : {}}
          >
            {isCompleted ? '✓' : stepNum}
          </motion.div>
        );
      })}
    </div>
  );
}
```

### MissionCard

```tsx
interface MissionCardProps {
  title: string;
  instruction: string;
  children?: React.ReactNode;  // CTA button or other content
}

export function MissionCard({ title, instruction, children }: MissionCardProps) {
  return (
    <motion.div
      className="skyla-mission-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="skyla-mission-card__title">{title}</h2>
      <p className="skyla-mission-card__instruction">{instruction}</p>
      {children}
    </motion.div>
  );
}
```

### CTAButton

```tsx
interface CTAButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function CTAButton({ label, onClick, disabled = false }: CTAButtonProps) {
  return (
    <motion.button
      className={`skyla-cta-btn ${disabled ? 'skyla-cta-btn--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.97 }}
    >
      {label}
      {!disabled && <span className="skyla-cta-btn__shimmer" />}
    </motion.button>
  );
}
```

### SummaryCard

```tsx
interface SummaryCardProps {
  label: string;
  value: string;
  stepNumber: number;
}

export function SummaryCard({ label, value, stepNumber }: SummaryCardProps) {
  return (
    <motion.div
      className="skyla-summary-card"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <div className="skyla-summary-card__header">
        <span className="skyla-summary-card__step">Step {stepNumber}</span>
        <span className="skyla-summary-card__check">✓</span>
      </div>
      <div className="skyla-summary-card__body">
        <span className="skyla-summary-card__label">{label}</span>
        <span className="skyla-summary-card__value">{value}</span>
      </div>
    </motion.div>
  );
}
```

### HintBar

```tsx
interface HintBarProps {
  text: string;
}

export function HintBar({ text }: HintBarProps) {
  return (
    <motion.div
      className="skyla-hint-bar"
      key={text}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <p className="skyla-hint-bar__text">{text}</p>
    </motion.div>
  );
}
```

### PositionGrid

```tsx
interface PositionGridProps {
  positions: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PositionGrid({ positions, selectedId, onSelect }: PositionGridProps) {
  return (
    <div className="skyla-position-grid">
      {positions.map((pos) => (
        <motion.button
          key={pos.id}
          className={`skyla-position-grid__card ${
            selectedId === pos.id ? 'skyla-position-grid__card--selected' : ''
          }`}
          onClick={() => onSelect(pos.id)}
          whileTap={{ scale: 0.95 }}
        >
          {pos.label}
        </motion.button>
      ))}
    </div>
  );
}
```

### ReviewCard

```tsx
interface ReviewCardProps {
  fields: { label: string; value: string }[];
  onConfirm: () => void;
  onBack: () => void;
}

export function ReviewCard({ fields, onConfirm, onBack }: ReviewCardProps) {
  return (
    <motion.div
      className="skyla-review-card"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="skyla-review-card__fields">
        {fields.map((field) => (
          <div key={field.label} className="skyla-review-card__row">
            <span className="skyla-review-card__label">{field.label}</span>
            <span className="skyla-review-card__value">{field.value}</span>
          </div>
        ))}
      </div>
      <div className="skyla-review-card__actions">
        <button className="skyla-review-card__back" onClick={onBack}>← Back</button>
        <CTAButton label="Confirm" onClick={onConfirm} />
      </div>
    </motion.div>
  );
}
```

### ManualInputPanel

```tsx
interface ManualInputPanelProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
}

export function ManualInputPanel({ onSubmit, placeholder }: ManualInputPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');

  return (
    <div className="skyla-manual-panel">
      <button
        className="skyla-manual-panel__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Hide manual input' : 'Enter manually'}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="skyla-manual-panel__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <input
              className="skyla-manual-panel__input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder || 'Type value...'}
            />
            <button
              className="skyla-manual-panel__submit"
              onClick={() => { onSubmit(value); setValue(''); }}
              disabled={!value.trim()}
            >
              Submit
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### StatusIndicator

```tsx
type StatusType = 'success' | 'error' | 'warning';

interface StatusIndicatorProps {
  type: StatusType;
  message: string;
}

export function StatusIndicator({ type, message }: StatusIndicatorProps) {
  const colorMap: Record<StatusType, string> = {
    success: 'var(--skyla-success)',
    error: 'var(--skyla-error)',
    warning: 'var(--skyla-warning)',
  };

  return (
    <motion.div
      className={`skyla-status skyla-status--${type}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
    >
      <span className="skyla-status__icon">
        {type === 'success' && '✓'}
        {type === 'error' && '✕'}
        {type === 'warning' && '⚠'}
      </span>
      <span className="skyla-status__message">{message}</span>
    </motion.div>
  );
}
```

## Framer Motion Integration Patterns

### Animation Constants

All animation durations and easing values are centralized:

```tsx
// mobile/components/skyla/motion-config.ts
export const MOTION = {
  duration: {
    fast: 0.2,
    normal: 0.3,
    emphasis: 0.4,
  },
  easing: {
    enter: [0.0, 0.0, 0.2, 1],   // decelerate
    exit: [0.4, 0.0, 1, 1],      // accelerate
    standard: [0.4, 0.0, 0.2, 1],
  },
  spring: {
    gentle: { type: 'spring', stiffness: 200, damping: 20 },
  },
} as const;
```

### Page Transition Pattern

Each page wrapped in AppShell uses AnimatePresence at the router level:

```tsx
// In the mobile router
<AnimatePresence mode="wait">
  <Routes location={location} key={location.pathname}>
    <Route path="/scan" element={<ScanPage />} />
    {/* ... */}
  </Routes>
</AnimatePresence>
```

### Card Entry Pattern

Cards use a staggered entry with `variants`:

```tsx
const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION.duration.normal } },
  exit: { opacity: 0, y: -10, transition: { duration: MOTION.duration.fast } },
};
```

### Performance Rules

1. Only animate `transform` and `opacity` (GPU-composited properties)
2. Use `will-change: transform` on elements that animate frequently
3. Maximum 3 concurrent animations per screen
4. Use `layout` prop only for reorder animations, not general positioning
5. Prefer CSS `@keyframes` for continuous ambient effects (shimmer, float) to avoid React re-renders

## Page Integration Strategy

### Wrapping Existing Pages

Each existing page is wrapped in `AppShell` without modifying its internal logic. The page's existing state (current step, scanned values, etc.) is passed to AppShell as props:

```tsx
// Example: ScanPage.tsx integration
export default function ScanPage() {
  // ... existing state and logic unchanged ...
  const { currentStep, totalSteps, completedSteps, stepLabels } = useScanFlow();

  return (
    <AppShell
      currentStep={currentStep}
      totalSteps={totalSteps}
      completedSteps={completedSteps}
      stepLabels={stepLabels}
      hintText={getHintForStep(currentStep)}
      title="QC Scan Mission"
    >
      <AnimatePresence mode="wait">
        {/* Existing scan content, now using new components */}
        <MissionCard
          key={currentStep}
          title={stepLabels[currentStep - 1]}
          instruction={getInstructionForStep(currentStep)}
        >
          <CTAButton label="Scan QR" onClick={handleScan} disabled={isScanning} />
          <ManualInputPanel onSubmit={handleManualInput} />
        </MissionCard>
      </AnimatePresence>

      {/* Completed steps shown as summary cards */}
      {completedSteps.map((step) => (
        <SummaryCard
          key={step}
          stepNumber={step}
          label={stepLabels[step - 1]}
          value={scannedValues[step]}
        />
      ))}
    </AppShell>
  );
}
```

### Pages and Their Shell Configuration

| Page | AppShell title | Has StepProgress | Has HintBar |
|------|---------------|-----------------|-------------|
| ScanPage | "QC Scan Mission" | Yes | Yes |
| FlowSelectionPage | "Select Flow" | No | Yes |
| WorkOrderFlowPage | "Work Order" | Yes | Yes |
| SlotSelectionPage | "Select Slot" | No | Yes |
| CustomFlowPage | "Custom Scan" | Yes | Yes |
| DiscLayoutPage | "Disc Layout" | No | No |
| InspectionProgressPage | "Inspection" | Yes | Yes |
| InspectionResultPage | "Results" | No | No |
| CurveFitPage | "Curve Fit" | No | No |
| LoginPage | "Skyla QC" | No | No |

### Background Decorations

The AppShell renders decorative SVG shapes positioned absolutely behind content:

```css
.skyla-app-shell::before,
.skyla-app-shell::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  opacity: 0.08;
  pointer-events: none;
  animation: skyla-float 8s ease-in-out infinite;
}

.skyla-app-shell::before {
  width: 200px;
  height: 200px;
  background: var(--skyla-green);
  top: -60px;
  right: -40px;
}

.skyla-app-shell::after {
  width: 150px;
  height: 150px;
  background: var(--skyla-blue);
  bottom: 80px;
  left: -50px;
  animation-delay: -4s;
}
```

## Data Models

### Step Configuration

```tsx
interface StepConfig {
  id: number;
  label: string;
  instruction: string;
  hint: string;
  requiresScan: boolean;
}

interface ScanFlowState {
  steps: StepConfig[];
  currentStep: number;
  completedSteps: number[];
  scannedValues: Record<number, string>;
  status: 'idle' | 'scanning' | 'success' | 'error';
  errorMessage?: string;
}
```

### Position Selection

```tsx
interface Position {
  id: string;
  label: string;
}

interface PositionSelectionState {
  positions: Position[];
  selectedId: string | null;
}
```

### Review Data

```tsx
interface ReviewField {
  label: string;
  value: string;
}

interface ReviewState {
  fields: ReviewField[];
  isConfirmed: boolean;
}
```

## Error Handling

### Scan Errors

When `html5-qrcode` reports an error or `tuttiScanVerifier` rejects a scan:
1. The `StatusIndicator` renders with `type="error"` and the error message
2. The MissionCard remains visible so the operator can retry
3. The CTA button re-enables after the error animation completes (400ms)

### Network Errors

When API calls fail:
1. Display `StatusIndicator` with `type="warning"` and a retry prompt
2. The existing retry logic in the page components is preserved
3. No new error handling logic is introduced — only visual presentation changes

### Invalid QR Data

When parsers (`qbiQrParser`, `workOrderQrParser`) return null or throw:
1. The existing error state in the page component triggers
2. The new UI renders the error via `StatusIndicator`
3. The operator can re-scan or use `ManualInputPanel`

## Accessibility

- All interactive elements have minimum 48×48px tap targets
- Color contrast ratios meet WCAG AA (4.5:1 for text, 3:1 for large text)
- White (#FFFFFF) on Skyla Green (#7FBF3F) achieves ~3.2:1 — use bold/large text (18px+) or darken to #5A9A2F for small text
- Animations respect `prefers-reduced-motion` media query:

```css
@media (prefers-reduced-motion: reduce) {
  .skyla-cta-btn__shimmer { animation: none; }
  .skyla-app-shell::before,
  .skyla-app-shell::after { animation: none; }
}
```

```tsx
// In Framer Motion components
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Pass transition={{ duration: prefersReduced ? 0 : MOTION.duration.normal }}
```

## File Modification Boundaries

### Files to CREATE (new)
- `mobile/components/skyla/AppShell.tsx`
- `mobile/components/skyla/BrandHeader.tsx`
- `mobile/components/skyla/StepProgress.tsx`
- `mobile/components/skyla/MissionCard.tsx`
- `mobile/components/skyla/SummaryCard.tsx`
- `mobile/components/skyla/CTAButton.tsx`
- `mobile/components/skyla/HintBar.tsx`
- `mobile/components/skyla/PositionGrid.tsx`
- `mobile/components/skyla/ReviewCard.tsx`
- `mobile/components/skyla/ManualInputPanel.tsx`
- `mobile/components/skyla/StatusIndicator.tsx`
- `mobile/components/skyla/motion-config.ts`
- `mobile/styles/skyla-theme.css`
- `mobile/styles/skyla-animations.css`
- `mobile/styles/skyla-components.css`

### Files to MODIFY (presentation only)
- `mobile/ScanPage.tsx` — wrap in AppShell, use new components
- `mobile/FlowSelectionPage.tsx` — wrap in AppShell
- `mobile/WorkOrderFlowPage.tsx` — wrap in AppShell
- `mobile/SlotSelectionPage.tsx` — wrap in AppShell
- `mobile/CustomFlowPage.tsx` — wrap in AppShell
- `mobile/DiscLayoutPage.tsx` — wrap in AppShell
- `mobile/InspectionProgressPage.tsx` — wrap in AppShell
- `mobile/InspectionResultPage.tsx` — wrap in AppShell
- `mobile/CurveFitPage.tsx` — wrap in AppShell
- `mobile/LoginPage.tsx` — wrap in AppShell (no progress bar)
- `mobile/App.tsx` — import CSS files, add AnimatePresence to router
- `mobile/styles.css` — import new CSS files

### Files NOT to modify
- `qbiQrParser.ts`
- `workOrderQrParser.ts`
- `tuttiScanVerifier.ts`
- Backend API endpoints
- RDS schema
- `TemplateManagementPage.tsx`
- Build-lines page data flow

## Testing Strategy

### Unit Tests (Example-based)
- Verify AppShell renders header, progress, content slot, and hint bar in correct order
- Verify LoginPage renders without StepProgress (no step data)
- Verify ManualInputPanel starts collapsed
- Verify CTA button minimum tap target size (48×48px via CSS)
- Verify safe-area CSS custom properties reference `env()` values
- Verify `prefers-reduced-motion` disables animations

### Property Tests (fast-check)
- StepProgress visual state correctness (Property 1)
- CTA button shimmer/disabled correlation (Property 2)
- SummaryCard content rendering (Property 3)
- HintBar text display (Property 4)
- PositionGrid selection highlighting (Property 5)
- ReviewCard field rendering (Property 6)
- StatusIndicator type-to-color mapping (Property 7)
- Animation duration bounds (Property 8)
- Color palette definition completeness (Property 9)
- MissionCard content rendering (Property 10)

### Integration Tests
- Full scan flow renders correctly through all steps without logic changes
- Page transitions animate via Framer Motion AnimatePresence
- html5-qrcode integration remains functional within new AppShell

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Step progress renders correct visual states

*For any* step configuration with `currentStep` (1..N), `totalSteps` (N), and `completedSteps` (subset of 1..N), the StepProgress component SHALL render exactly N indicators where each completed step shows a checkmark, the active step has the active class, and all others have the default class.

**Validates: Requirements 2.2, 3.1, 3.2, 3.4**

### Property 2: CTA button shimmer correlates with enabled state

*For any* CTAButton render with a `disabled` prop value, the shimmer element SHALL be present if and only if `disabled` is false, and the button opacity SHALL be reduced if and only if `disabled` is true.

**Validates: Requirements 5.2, 5.3**

### Property 3: Summary card displays complete step result

*For any* completed scan step with a label string and scanned value string, the SummaryCard SHALL render both the label and value text content along with a success indicator.

**Validates: Requirements 6.1, 6.3**

### Property 4: Hint bar reflects current step context

*For any* scan step with an associated hint message, the HintBar SHALL display exactly that hint text string.

**Validates: Requirements 7.2, 7.4**

### Property 5: Position grid selection highlights correct card

*For any* set of positions and a selected position ID, the PositionGrid SHALL apply the selected visual class to exactly the card matching that ID and no others.

**Validates: Requirements 8.1, 8.2**

### Property 6: Review card renders all data fields

*For any* array of review fields (each with label and value), the ReviewCard SHALL render every field's label and value in the output.

**Validates: Requirements 9.1, 9.3**

### Property 7: Status indicator maps outcome type to correct color

*For any* status type in {success, error, warning}, the StatusIndicator SHALL apply the corresponding semantic color variable (--skyla-success, --skyla-error, --skyla-warning) and display the provided message text.

**Validates: Requirements 10.1, 10.2, 10.3**

### Property 8: Animation durations do not exceed 400ms

*For any* non-ambient Framer Motion transition configuration in the component library, the duration value SHALL be less than or equal to 0.4 seconds.

**Validates: Requirements 10.4, 13.2**

### Property 9: Color palette completeness

*For any* color token in the defined Skyla palette (green, blue, bg, card, muted, success, warning, error), the CSS custom property SHALL be defined in skyla-theme.css with the exact hex value from the specification.

**Validates: Requirements 12.3**

### Property 10: Mission card renders task content

*For any* MissionCard with a title string and instruction string, the rendered output SHALL contain both the title and instruction text.

**Validates: Requirements 4.2**
