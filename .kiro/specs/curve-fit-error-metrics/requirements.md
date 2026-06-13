# Requirements Document

## Introduction

Add an error metrics and quality judgment panel to the curve fitting area on the PC build-lines page (`TemplateManagementPage.tsx`). The panel computes TEa, OD range, bias, and CV quality checks using curve fit data and Qbi specifications, displaying PASS/FAIL indicators per control level. This enables QC personnel to immediately assess curve fit quality without manually consulting spec tables.

## Glossary

- **Error_Metrics_Panel**: A UI component displayed in the fit-inspector section showing computed quality metrics and PASS/FAIL judgments for the selected curve fit
- **Fit_Inspector**: The existing detail section in TemplateManagementPage that displays information about the selected BaselineFit item
- **Qbi_Spec**: A specification record (SpecRow) containing threshold values for TEa, OD ranges, CV limits, and bias limits for a given marker
- **Control_Level**: One of the known patient_id control identifiers (control-1 = L1, control-2 = L2, control-3 = N1, control-4 = N3)
- **TEa**: Total Allowable Error, a quality metric computed as |bias%| + 2 × CV% and compared against the reference TEa threshold from Qbi_Spec
- **OD_Mean**: The arithmetic mean of Final Delta OD replicate values for a given Control_Level
- **CV_Percent**: Coefficient of Variation expressed as a percentage, computed as (standard_deviation / |mean|) × 100 from OD replicate values
- **Bias_Percent**: Relative deviation of measured concentration from expected concentration, computed as (conc_measured - conc_expected) / conc_expected × 100
- **Conc_Measured**: Concentration derived from the fitted curve using conc = (OD_Mean - intercept) / slope
- **Conc_Expected**: The known CS concentration for a Control_Level, sourced from the BaselinePoint conc field
- **Bead_Name**: The reagent bead identifier used to look up Qbi_Spec via the `/api/spec/lookup/:beadName` endpoint
- **Marker_Resolution**: The process of deriving a bead name from the analyze_item to perform Qbi_Spec lookup (e.g., analyze_item "ALB" maps to bead name "QALB")

## Requirements

### Requirement 1: Qbi Spec Lookup from Analyze Item

**User Story:** As a QC operator, I want the system to automatically resolve the bead name from the selected analyze_item and fetch the Qbi spec, so that quality thresholds are available for judgment without manual lookup.

#### Acceptance Criteria

1. WHEN a BaselineFit item is selected in the Fit_Inspector, THE Error_Metrics_Panel SHALL resolve the Bead_Name by prepending "Q" to the analyze_item value
2. WHEN the Bead_Name is resolved, THE Error_Metrics_Panel SHALL call the `/api/spec/lookup/:beadName` endpoint to fetch the Qbi_Spec
3. IF the spec lookup returns null for the qbi field, THEN THE Error_Metrics_Panel SHALL display a "Spec not found" message and omit all quality checks
4. IF the spec lookup request fails due to a network error, THEN THE Error_Metrics_Panel SHALL display an error indicator and allow the user to retry

### Requirement 2: TEa Check per Control Level

**User Story:** As a QC operator, I want to see whether the Total Allowable Error for each control level passes the Qbi spec threshold, so that I can judge overall curve fit quality.

#### Acceptance Criteria

1. WHEN curve fit data and Qbi_Spec are available, THE Error_Metrics_Panel SHALL compute Conc_Measured for each Control_Level using the formula: conc_measured = (OD_Mean - intercept) / slope
2. WHEN Conc_Measured and Conc_Expected are both available for a Control_Level, THE Error_Metrics_Panel SHALL compute Bias_Percent as (Conc_Measured - Conc_Expected) / Conc_Expected × 100
3. WHEN OD replicate values exist for a Control_Level, THE Error_Metrics_Panel SHALL compute CV_Percent from those replicate OD values
4. WHEN Bias_Percent and CV_Percent are computed, THE Error_Metrics_Panel SHALL compute TEa_actual as |Bias_Percent| + 2 × CV_Percent
5. WHEN TEa_actual and the Qbi_Spec tea threshold are both available, THE Error_Metrics_Panel SHALL display PASS when TEa_actual is less than or equal to the tea threshold, and FAIL otherwise
6. IF Conc_Expected is zero or null for a Control_Level, THEN THE Error_Metrics_Panel SHALL skip the TEa check for that level and display "N/A"

### Requirement 3: Control OD Range Check

**User Story:** As a QC operator, I want to verify that control OD mean values fall within the Qbi spec ranges, so that I can confirm the instrument signal level is acceptable.

#### Acceptance Criteria

1. WHEN Qbi_Spec spec_l1_od is available, THE Error_Metrics_Panel SHALL parse the range string (format "min - max") and check if the Control_Level L1 OD_Mean falls within that range
2. WHEN Qbi_Spec spec_l2_od is available, THE Error_Metrics_Panel SHALL parse the range string and check if the Control_Level L2 OD_Mean falls within that range
3. WHEN Qbi_Spec spec_n1_od is available and Control_Level N1 data exists, THE Error_Metrics_Panel SHALL check if the N1 OD_Mean falls within the spec_n1_od range
4. THE Error_Metrics_Panel SHALL display the actual OD_Mean value alongside a PASS or FAIL indicator for each checked level
5. IF the spec range field is null or unparseable for a Control_Level, THEN THE Error_Metrics_Panel SHALL skip that OD range check and display "N/A"

### Requirement 4: Concentration Bias Check per Control

**User Story:** As a QC operator, I want to see whether the measured concentration bias for each control level passes the merge_bias threshold, so that I can assess systematic deviation.

#### Acceptance Criteria

1. WHEN Conc_Measured and Conc_Expected are available for L1, THE Error_Metrics_Panel SHALL compute |Bias_Percent| and compare it against the merge_bias threshold from Qbi_Spec
2. WHEN Conc_Measured and Conc_Expected are available for L2, THE Error_Metrics_Panel SHALL compute |Bias_Percent| and compare it against the merge_bias threshold from Qbi_Spec
3. WHEN N1 or N3 data is available and Qbi_Spec provides a merge_bias threshold, THE Error_Metrics_Panel SHALL perform the same bias check for those levels
4. THE Error_Metrics_Panel SHALL display PASS when |Bias_Percent| is less than or equal to the merge_bias threshold, and FAIL otherwise
5. IF the merge_bias field is null or unparseable, THEN THE Error_Metrics_Panel SHALL skip the bias check and display "N/A"

### Requirement 5: CV% Check per Control

**User Story:** As a QC operator, I want to see whether the OD replicate CV% for each control level passes the merge_cv threshold, so that I can assess measurement precision.

#### Acceptance Criteria

1. WHEN OD replicate values are available for L1, THE Error_Metrics_Panel SHALL compute CV_Percent and compare it against the merge_cv threshold from Qbi_Spec
2. WHEN OD replicate values are available for L2, THE Error_Metrics_Panel SHALL compute CV_Percent and compare it against the merge_cv threshold from Qbi_Spec
3. WHEN N1 or N3 OD replicates exist and Qbi_Spec provides a merge_cv threshold, THE Error_Metrics_Panel SHALL perform the same CV check for those levels
4. THE Error_Metrics_Panel SHALL display PASS when CV_Percent is less than or equal to the merge_cv threshold, and FAIL otherwise
5. IF the merge_cv field is null or unparseable, THEN THE Error_Metrics_Panel SHALL skip the CV check and display "N/A"

### Requirement 6: Panel Layout and Placement

**User Story:** As a QC operator, I want error metrics displayed clearly next to the curve fit inspector, so that I can see quality judgment without additional navigation.

#### Acceptance Criteria

1. THE Error_Metrics_Panel SHALL be rendered inside the fit-inspector section, positioned between the inspector header (h3 with analyze_item name) and the "檢視測試數據" button
2. THE Error_Metrics_Panel SHALL occupy the empty space to the LEFT of the "檢視測試數據" button in the inspector-actions area
3. THE Error_Metrics_Panel SHALL use a compact layout that displays check results as colored indicators (green for PASS, red for FAIL, gray for N/A)
4. THE Error_Metrics_Panel SHALL match the existing dark theme styling defined in assay-baseline.css
5. WHILE the Qbi_Spec is being fetched, THE Error_Metrics_Panel SHALL display a loading indicator in place of the check results

### Requirement 7: OD Replicate Grouping per Control Level

**User Story:** As a QC operator, I want OD replicates correctly grouped by control level, so that CV and mean calculations reflect the actual measurement set.

#### Acceptance Criteria

1. THE Error_Metrics_Panel SHALL group BaselinePoint entries by patient_id to identify replicates for each Control_Level (control-1 → L1, control-2 → L2, control-3 → N1, control-4 → N3)
2. THE Error_Metrics_Panel SHALL use all Final Delta OD values within a Control_Level group as replicates for OD_Mean and CV_Percent computation
3. IF a Control_Level has fewer than 2 replicate OD values, THEN THE Error_Metrics_Panel SHALL display the OD_Mean but mark CV_Percent as "N/A" for that level

### Requirement 8: Threshold Parsing from Spec Fields

**User Story:** As a QC operator, I want the system to correctly parse threshold values from Qbi spec text fields, so that judgments use the correct numeric thresholds.

#### Acceptance Criteria

1. WHEN the tea field contains a percentage value (e.g., "8%", "20%"), THE Error_Metrics_Panel SHALL extract the numeric value and use it as the TEa threshold percentage
2. WHEN the merge_bias field contains a threshold expression (e.g., "<±5%", "L1<5%;L2<8%"), THE Error_Metrics_Panel SHALL parse the numeric threshold per level using the existing parseSpecThresholds utility pattern
3. WHEN the merge_cv field contains a threshold expression (e.g., "<3%", "L1 CV<4%;L2 CV<5%"), THE Error_Metrics_Panel SHALL parse the numeric threshold per level using the existing parseSpecThresholds utility pattern
4. WHEN the spec_l1_od or spec_l2_od field contains a range string (e.g., "1.545 - 1.886"), THE Error_Metrics_Panel SHALL parse it into min and max numeric values using the existing parseSpecRange utility pattern
