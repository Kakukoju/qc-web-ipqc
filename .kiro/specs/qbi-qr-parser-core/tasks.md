# Implementation Plan: Qbi QR Parser Core

## Overview

Implement a pure TypeScript parser function `parseQbiQr(rawQr)` that decodes Qbi Disc QR Code strings (1173-character numeric strings) into structured JSON. The implementation includes constant lookup maps, the parser function with validation/extraction/computation logic, and comprehensive tests using Vitest with property-based testing via fast-check.

## Tasks

- [x] 1. Set up test framework and constant maps
  - [x] 1.1 Install Vitest and fast-check as dev dependencies, add test script to package.json
    - Run `npm install -D vitest fast-check`
    - Add `"test": "vitest --run"` script to package.json
    - Verify Vitest runs with an empty test file
    - _Requirements: 7.2_

  - [x] 1.2 Create `src/constants/panelMap.ts` with PANEL_MAP and PanelInfo type
    - Export `PanelInfo` type with fields: panelName, productCode, onePieceBoxPanelType, discCategory
    - Export `PANEL_MAP` as `Record<string, PanelInfo>` with initial entry `"00-001"`
    - _Requirements: 4.2, 7.3_

  - [x] 1.3 Create `src/constants/markerMap.ts` with MARKER_MAP and SPECIES_LINE_MAP
    - Export `MARKER_MAP` as `Record<string, string>` with entries for "033" (UCRE) and "034" (UPRO)
    - Export `SPECIES_LINE_MAP` as `Record<string, string>` with entries for "0" (Control), "1" (Dog), "2" (Cat), "3" (Horse)
    - _Requirements: 6.7, 6.8, 6.9, 7.4, 7.5_

- [x] 2. Implement core parser function
  - [x] 2.1 Create `src/lib/qbiQrParser.ts` with types and input validation
    - Export `ParsedQbiQr` type as defined in design
    - Implement input validation: non-numeric check, length handling (>1173 truncate with extraTail, <1173 warning)
    - Set `raw.inputLength` and `raw.parsedLength` correctly for all inputs
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Implement `extractProduction()` for production section extraction
    - Extract all 17 fields from first 41 characters using fixed-position slicing
    - Add comments documenting 1-based position for each field
    - Ensure concatenation of all fields reproduces original first 41 chars
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19_

  - [x] 2.3 Implement `computeDates()` for date computation
    - Compute productionDate as `20${year}-${month}-${day}`
    - Compute expirationDate as productionDate + validMonth months - 1 day
    - Validate date components (month 1-12, day 1-31, actual date existence)
    - Handle month/year boundary crossings correctly
    - Return errors array for invalid dates
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.4 Implement `lookupPanel()` for panel map lookup
    - Construct key as `${discType}-${subPanelType}`
    - Return matching PanelInfo fields if key exists
    - Return fallback values ("Unknown Panel", null, "Unknown") if key not found
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.5 Implement `computeLotNumbers()` for lot number generation
    - Compute discLotNo: `${lineNumber}-${subPanelType}-${YYMMDD}${batchNumber}`
    - Compute reportLotNo: `${lineNumber}${subPanelType}${YYMMDD}${batchNumber}`
    - Compute whiteBoxLotNo: `${salesCode last char}-${productCode no dash}-${YYMMDD}${batchNumber}` or null
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.6 Implement `extractMarkers()` for reagent marker extraction
    - Extract 8 marker entries starting at offset 41, each 122 chars
    - Extract markerNumber (slice 0-3), wellNumber (slice 3-5), speciesLine (slice 121-122)
    - Set used=false for markerNumber "000", used=true otherwise
    - Look up markerName from MARKER_MAP with "Unknown Marker" fallback
    - Look up speciesName from SPECIES_LINE_MAP with "Unknown" fallback
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 2.7 Wire all functions together in `parseQbiQr()` main function
    - Call validation, extractProduction, computeDates, lookupPanel, computeLotNumbers, extractMarkers in sequence
    - Assemble and return complete ParsedQbiQr object
    - Ensure function is pure with no side effects
    - _Requirements: 7.1_

- [x] 3. Checkpoint - Verify parser compiles and basic structure
  - Ensure TypeScript compiles without errors, ask the user if questions arise.

- [x] 4. Write unit tests
  - [x] 4.1 Create `src/lib/qbiQrParser.test.ts` with 7 required test scenarios
    - Test 1: Normal QR parses correctly (ok=true, panelName, dates, lot numbers)
    - Test 2: Marker vs Well correctness (UCRE on well 01, UPRO on well 04, both Dog)
    - Test 3: QR longer than 1173 (extraTail populated, warning present)
    - Test 4: QR shorter than 1173 (warning present, partial parse)
    - Test 5: QR with non-numeric characters (ok=false, error present)
    - Test 6: markerNumber "000" produces used=false
    - Test 7: Unknown markerNumber produces "Unknown Marker"
    - _Requirements: 1.1, 1.3, 1.4, 2.2, 3.1, 3.2, 4.2, 5.1, 5.2, 5.3, 6.6, 6.8_

  - [ ]* 4.2 Write property test: Production field round-trip (Property 1)
    - **Property 1: Parsing round-trip consistency (production fields)**
    - For any random 1173-char numeric string, concatenating all production fields must equal input.slice(0, 41)
    - Use fast-check to generate random numeric strings of length 1173
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 4.3 Write property test: Length invariant (Property 2)
    - **Property 2: Length invariant**
    - For any input string, raw.inputLength === input.length and raw.parsedLength === Math.min(input.length, 1173)
    - Use fast-check to generate strings of varying lengths
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 4.4 Write property test: Marker count invariant (Property 3)
    - **Property 3: Marker count invariant**
    - For any 1173-char numeric string, markerWellMap.length === 8 with indices 0-7
    - **Validates: Requirements 6.1**

  - [ ]* 4.5 Write property test: Unused marker identification (Property 4)
    - **Property 4: Unused marker identification**
    - For any marker with markerNumber "000", used===false and markerName===""
    - For any marker with markerNumber !== "000", used===true
    - **Validates: Requirements 6.6, 6.7**

  - [ ]* 4.6 Write property test: Panel lookup fallback (Property 5)
    - **Property 5: Panel lookup fallback consistency**
    - For any QR with panel key not in PANEL_MAP, panelName==="Unknown Panel", productCode===null, discCategory==="Unknown"
    - **Validates: Requirements 4.3**

  - [ ]* 4.7 Write property test: White box lot null (Property 6)
    - **Property 6: White box lot null when no product code**
    - For any result where productCode is null, whiteBoxLotNo must also be null
    - **Validates: Requirements 5.4**

  - [ ]* 4.8 Write property test: Non-numeric input fails (Property 7)
    - **Property 7: Non-numeric input always fails**
    - For any string with at least one non-digit character, ok===false and errors is non-empty
    - **Validates: Requirements 1.1**

  - [ ]* 4.9 Write property test: Expiration after production (Property 8)
    - **Property 8: Expiration date is always after production date**
    - For any valid QR with valid dates and validMonth > 0, expirationDate > productionDate
    - **Validates: Requirements 3.4**

  - [ ]* 4.10 Write property test: Lot number derivation (Property 9)
    - **Property 9: Lot number derivation from production fields**
    - For any valid 1173-char numeric QR, discLotNo and reportLotNo match expected format derived from production fields
    - **Validates: Requirements 5.1, 5.2**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and ensure all unit tests and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1: Setup",
      "tasks": ["1"]
    },
    {
      "name": "Wave 2: Core Implementation",
      "tasks": ["2"]
    },
    {
      "name": "Wave 3: Compilation Check",
      "tasks": ["3"]
    },
    {
      "name": "Wave 4: Testing",
      "tasks": ["4"]
    },
    {
      "name": "Wave 5: Final Verification",
      "tasks": ["5"]
    }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The test framework (Vitest + fast-check) must be installed first since it's not currently in package.json
- All code is pure TypeScript with no React/DOM/browser dependencies
- Property tests use fast-check for random input generation with minimum 100 iterations
- The reference QR string from the task spec should be used for unit tests
