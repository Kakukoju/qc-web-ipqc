# Requirements Document

## Introduction

This document specifies the requirements for the Qbi QR Parser Core — a pure TypeScript parser function that decodes Qbi Disc QR Code strings into structured JSON. The parser handles fixed-length numeric strings (1173 characters), extracts production parameters, performs date computations, looks up panel and marker information from constant maps, computes lot numbers, and reports errors/warnings for invalid input. The parser has no UI, API, or database dependencies.

## Glossary

- **Parser**: The `parseQbiQr` function that accepts a raw QR string and returns a structured `ParsedQbiQr` object
- **QR_String**: A fixed-length numeric string of 1173 characters representing encoded Qbi Disc data
- **Production_Section**: Characters 1–41 (1-based) of the QR string containing production metadata
- **Reagent_Section**: Characters 42–1017 (1-based) of the QR string containing 8 marker blocks of 122 characters each
- **Cartridge_Section**: Characters 1018–1173 (1-based) of the QR string containing cartridge parameters
- **PANEL_MAP**: A constant lookup table mapping `discType-subPanelType` keys to panel information
- **MARKER_MAP**: A constant lookup table mapping 3-digit marker numbers to marker names
- **SPECIES_LINE_MAP**: A constant lookup table mapping single-digit species line codes to species names
- **Marker_Block**: A 122-character segment within the Reagent Section representing one marker/well entry
- **Lot_Number**: A formatted string identifier derived from production fields and panel information

## Requirements

### Requirement 1: Input Validation

**User Story:** As a developer, I want the parser to validate QR input strings, so that invalid data is clearly reported and does not produce incorrect results.

#### Acceptance Criteria

1. WHEN a QR string containing non-numeric characters is provided, THE Parser SHALL set `ok` to `false` and add a descriptive error to the `errors` array
2. WHEN a QR string of exactly 1173 numeric characters is provided, THE Parser SHALL parse it without errors or warnings related to length
3. WHEN a QR string longer than 1173 characters is provided, THE Parser SHALL parse only the first 1173 characters, store the remainder in `raw.extraTail`, and add a warning to the `warnings` array
4. WHEN a QR string shorter than 1173 characters is provided, THE Parser SHALL parse all available characters and add a warning to the `warnings` array
5. THE Parser SHALL always set `raw.inputLength` to the length of the original input string
6. THE Parser SHALL always set `raw.parsedLength` to the minimum of the input length and 1173

### Requirement 2: Production Section Extraction

**User Story:** As a developer, I want the parser to extract all production fields from the first 41 characters, so that production metadata is available in a structured format.

#### Acceptance Criteria

1. THE Parser SHALL extract 17 production fields from the first 41 characters using fixed-position slicing
2. WHEN the production section is extracted, THE Parser SHALL produce fields whose concatenation in order equals the original first 41 characters of the parsed QR string
3. THE Parser SHALL extract `formatVersion` from characters 1–2 (0-based slice 0–2, length 2)
4. THE Parser SHALL extract `year` from characters 3–4 (0-based slice 2–4, length 2)
5. THE Parser SHALL extract `month` from characters 5–6 (0-based slice 4–6, length 2)
6. THE Parser SHALL extract `day` from characters 7–8 (0-based slice 6–8, length 2)
7. THE Parser SHALL extract `factoryNumber` from character 9 (0-based slice 8–9, length 1)
8. THE Parser SHALL extract `lineNumber` from character 10 (0-based slice 9–10, length 1)
9. THE Parser SHALL extract `batchNumber` from characters 11–12 (0-based slice 10–12, length 2)
10. THE Parser SHALL extract `validMonth` from characters 13–14 (0-based slice 12–14, length 2)
11. THE Parser SHALL extract `discType` from characters 15–16 (0-based slice 14–16, length 2)
12. THE Parser SHALL extract `subPanelType` from characters 17–19 (0-based slice 16–19, length 3)
13. THE Parser SHALL extract `salesCode` from characters 20–21 (0-based slice 19–21, length 2)
14. THE Parser SHALL extract `brandCode` from character 22 (0-based slice 21–22, length 1)
15. THE Parser SHALL extract `humanVet` from character 23 (0-based slice 22–23, length 1)
16. THE Parser SHALL extract `serialNumber` from characters 24–28 (0-based slice 23–28, length 5)
17. THE Parser SHALL extract `appCode` from character 29 (0-based slice 28–29, length 1)
18. THE Parser SHALL extract `lotTraceNo` from characters 30–39 (0-based slice 29–39, length 10)
19. THE Parser SHALL extract `reserved` from characters 40–41 (0-based slice 39–41, length 2)

### Requirement 3: Date Computation

**User Story:** As a developer, I want the parser to compute production and expiration dates from extracted fields, so that date information is available in standard ISO format.

#### Acceptance Criteria

1. THE Parser SHALL compute `productionDate` as `20${year}-${month}-${day}` in `YYYY-MM-DD` format
2. THE Parser SHALL compute `expirationDate` as the production date plus `validMonth` months minus 1 day, in `YYYY-MM-DD` format
3. WHEN the computed production date is invalid (e.g., month > 12, day > 31, or non-existent date), THE Parser SHALL set `ok` to `false` and add a descriptive error
4. WHEN the production date and validMonth are valid, THE Parser SHALL produce an expiration date that is strictly after the production date
5. THE Parser SHALL handle month and year boundary crossings correctly when computing the expiration date

### Requirement 4: Panel Lookup

**User Story:** As a developer, I want the parser to look up panel information from a constant map, so that disc type and panel details are resolved automatically.

#### Acceptance Criteria

1. THE Parser SHALL construct the panel key as `${discType}-${subPanelType}`
2. WHEN the panel key exists in PANEL_MAP, THE Parser SHALL return the matching `panelName`, `productCode`, and `discCategory`
3. WHEN the panel key does not exist in PANEL_MAP, THE Parser SHALL set `panelName` to "Unknown Panel", `productCode` to `null`, and `discCategory` to "Unknown"

### Requirement 5: Lot Number Generation

**User Story:** As a developer, I want the parser to compute three lot number formats from production fields, so that lot traceability information is available.

#### Acceptance Criteria

1. THE Parser SHALL compute `discLotNo` as `${lineNumber}-${subPanelType}-${YYMMDD}${batchNumber}`
2. THE Parser SHALL compute `reportLotNo` as `${lineNumber}${subPanelType}${YYMMDD}${batchNumber}`
3. WHEN `productCode` is not null, THE Parser SHALL compute `whiteBoxLotNo` as `${salesCode last character}-${productCode without dashes}-${YYMMDD}${batchNumber}`
4. WHEN `productCode` is null, THE Parser SHALL set `whiteBoxLotNo` to `null`

### Requirement 6: Reagent Marker Extraction

**User Story:** As a developer, I want the parser to extract marker/well information from the reagent section, so that reagent data is available in a structured array.

#### Acceptance Criteria

1. THE Parser SHALL extract exactly 8 marker entries from the reagent section starting at 0-based offset 41
2. THE Parser SHALL extract each marker from a 122-character block at offset `41 + index × 122`
3. THE Parser SHALL extract `markerNumber` from the first 3 characters of each marker block
4. THE Parser SHALL extract `wellNumber` from characters 4–5 of each marker block (0-based slice 3–5)
5. THE Parser SHALL extract `speciesLine` from character 122 of each marker block (0-based slice 121–122)
6. WHEN `markerNumber` equals "000", THE Parser SHALL set `used` to `false` and `markerName` to empty string
7. WHEN `markerNumber` does not equal "000", THE Parser SHALL set `used` to `true` and look up `markerName` from MARKER_MAP
8. WHEN a marker number is not found in MARKER_MAP, THE Parser SHALL set `markerName` to "Unknown Marker"
9. THE Parser SHALL look up `speciesName` from SPECIES_LINE_MAP, using "Unknown" as fallback

### Requirement 7: Pure Function and Extensibility

**User Story:** As a developer, I want the parser to be a pure function with extensible lookup maps, so that it can be reused across frontend and backend without side effects.

#### Acceptance Criteria

1. THE Parser SHALL be a pure function with no side effects and no mutations to the input string
2. THE Parser SHALL not depend on React, DOM, browser APIs, or any external services
3. THE PANEL_MAP SHALL be structured as a `Record<string, PanelInfo>` that can be extended by adding new entries
4. THE MARKER_MAP SHALL be structured as a `Record<string, string>` that can be extended by adding new entries
5. THE SPECIES_LINE_MAP SHALL be structured as a `Record<string, string>` that can be extended by adding new entries
