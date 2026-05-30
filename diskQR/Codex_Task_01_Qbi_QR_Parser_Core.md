# Codex Task 01 — Qbi QR Parser Core

## 任務目標

請先不要做 UI，也不要做 API。

本任務只建立 Qbi QR Code 的核心解析器，目標是讓 `parseQbiQr(rawQr)` 可以正確解析 Qbi Disc QR 字串，並通過單元測試。

資料流程如下：

```text
raw QR string
↓
parseQbiQr(rawQr)
↓
回傳標準 JSON
```

本階段不處理：

- 手機相機掃描
- React UI
- 後端 API
- DB 儲存
- Well 內 Marker 批次 / reagent lot / bead lot

---

## 需要建立 / 修改的檔案

請建立以下檔案：

```text
src/lib/qbiQrParser.ts
src/lib/qbiQrParser.test.ts
src/constants/panelMap.ts
src/constants/markerMap.ts
```

---

## 一、QR 基本規格

QR Code 是一串固定長度的純數字字串。

標準總長度：

```text
1173
```

QR 分為三大區段：

| 區段 | 1-based 起始 | 1-based 結束 | 長度 |
|---|---:|---:|---:|
| 生產參數 | 1 | 41 | 41 |
| 試劑參數 | 42 | 1017 | 976 |
| 卡匣參數 | 1018 | 1173 | 156 |

注意：

- 規格位置是 1-based index。
- TypeScript 實作請使用 0-based index。
- 如果 QR 長度大於 1173，請只取前 1173 碼解析，並把多出的字串放入 `raw.extraTail`，同時加入 warning。
- 如果 QR 長度小於 1173，仍盡量解析可解析欄位，但加入 warning。
- QR 只能包含數字。
- 如果包含非數字，`ok = false`，並回傳 error。

---

## 二、Production Section：第 1–41 碼

請依照以下欄位切片：

| 欄位 | 1-based 位置 | 0-based slice | 長度 |
|---|---:|---|---:|
| formatVersion | 1–2 | slice(0, 2) | 2 |
| year | 3–4 | slice(2, 4) | 2 |
| month | 5–6 | slice(4, 6) | 2 |
| day | 7–8 | slice(6, 8) | 2 |
| factoryNumber | 9 | slice(8, 9) | 1 |
| lineNumber | 10 | slice(9, 10) | 1 |
| batchNumber | 11–12 | slice(10, 12) | 2 |
| validMonth | 13–14 | slice(12, 14) | 2 |
| discType | 15–16 | slice(14, 16) | 2 |
| subPanelType | 17–19 | slice(16, 19) | 3 |
| salesCode | 20–21 | slice(19, 21) | 2 |
| brandCode | 22 | slice(21, 22) | 1 |
| humanVet | 23 | slice(22, 23) | 1 |
| serialNumber | 24–28 | slice(23, 28) | 5 |
| appCode | 29 | slice(28, 29) | 1 |
| lotTraceNo | 30–39 | slice(29, 39) | 10 |
| reserved | 40–41 | slice(39, 41) | 2 |

---

## 三、日期規則

### 生產日期

```text
productionDate = 20 + year + "-" + month + "-" + day
```

例如：

```text
year = 25
month = 05
day = 16

productionDate = 2025-05-16
```

### 效期日期

```text
expirationDate = productionDate + validMonth 個月 - 1 天
```

例如：

```text
productionDate = 2025-05-16
validMonth = 12

expirationDate = 2026-05-15
```

請注意：

- 日期格式固定輸出 `YYYY-MM-DD`
- 若日期不合法，請加入 error，並讓 `ok = false`
- 不要只用字串相加，請用 Date 或可靠日期函式處理跨月、跨年問題

---

## 四、Panel 對照表

請建立：

```text
src/constants/panelMap.ts
```

內容如下：

```ts
export type PanelInfo = {
  panelName: string;
  productCode: string;
  onePieceBoxPanelType: string;
  discCategory: string;
};

export const PANEL_MAP: Record<string, PanelInfo> = {
  "00-001": {
    panelName: "Core Chem 13",
    productCode: "905-100",
    onePieceBoxPanelType: "000001",
    discCategory: "Vet 生化",
  },
};
```

判斷 key：

```text
panelKey = discType + "-" + subPanelType
```

若找不到 panel：

```ts
panelName = "Unknown Panel";
productCode = null;
discCategory = "Unknown";
```

---

## 五、Marker 對照表

請建立：

```text
src/constants/markerMap.ts
```

內容如下：

```ts
export const MARKER_MAP: Record<string, string> = {
  "033": "UCRE",
  "034": "UPRO",
};

export const SPECIES_LINE_MAP: Record<string, string> = {
  "0": "Control",
  "1": "Dog",
  "2": "Cat",
  "3": "Horse",
};
```

如果找不到 marker：

```text
Unknown Marker
```

如果找不到 species line：

```text
Unknown
```

---

## 六、Lot No 組合規則

請輸出三種 Lot No。

### 1. Disc Lot No

```text
lineNumber-subPanelType-YYMMDDbatchNumber
```

範例：

```text
0-001-25051600
```

### 2. Report Lot No

```text
lineNumber + subPanelType + YYMMDD + batchNumber
```

範例：

```text
000125051600
```

### 3. White Box Lot No

```text
salesCode 最後 1 碼 - productCode 去掉 dash - YYMMDDbatchNumber
```

範例：

```text
0-905100-25051600
```

若 productCode 不存在，請回傳 `null`。

---

## 七、Reagent Section：第 42–1017 碼

試劑參數總長度 976 碼。

規則：

```text
122 碼 × 8 marker
```

每組 marker 長度 122 碼。

Reagent section 在完整 QR 中的 0-based 起始位置是：

```ts
const REAGENT_START = 41;
```

每個 marker block：

```ts
const MARKER_BLOCK_LENGTH = 122;
const markerStart = REAGENT_START + index * MARKER_BLOCK_LENGTH;
const markerBlock = qr.slice(markerStart, markerStart + MARKER_BLOCK_LENGTH);
```

每組 marker 欄位如下：

| 欄位 | marker block 內 1-based 位置 | marker block 內 0-based slice | 長度 |
|---|---:|---|---:|
| markerNumber | 1–3 | slice(0, 3) | 3 |
| wellNumber | 4–5 | slice(3, 5) | 2 |
| eqTypeControl | 6–7 | slice(5, 7) | 2 |
| eqTypeReal | 8–9 | slice(7, 9) | 2 |
| spectrumGolden | 10–16 | slice(9, 16) | 7 |
| spectrumCorrection | 17–37 | slice(16, 37) | 21 |
| markerEqControl | 38–58 | slice(37, 58) | 21 |
| markerEqDog | 59–79 | slice(58, 79) | 21 |
| markerEqCat | 80–100 | slice(79, 100) | 21 |
| markerEqHorse | 101–121 | slice(100, 121) | 21 |
| speciesLine | 122 | slice(121, 122) | 1 |

目前本任務只需要輸出：

```text
markerNumber
markerName
wellNumber
speciesLine
speciesName
used
```

如果 markerNumber 是：

```text
000
```

代表該 marker 未使用：

```ts
used = false;
```

其他 markerNumber：

```ts
used = true;
```

---

## 八、Parser Function

請建立：

```ts
parseQbiQr(rawQr: string): ParsedQbiQr
```

型別如下：

```ts
export type ParsedQbiQr = {
  ok: boolean;
  errors: string[];
  warnings: string[];

  raw: {
    inputLength: number;
    parsedLength: number;
    extraTail?: string;
  };

  production: {
    formatVersion: string;
    year: string;
    month: string;
    day: string;
    productionDate: string;
    expirationDate: string;
    factoryNumber: string;
    lineNumber: string;
    batchNumber: string;
    validMonth: string;
    discType: string;
    subPanelType: string;
    salesCode: string;
    brandCode: string;
    humanVet: string;
    serialNumber: string;
    appCode: string;
    lotTraceNo: string;
    reserved: string;
  };

  panel: {
    panelKey: string;
    panelName: string;
    productCode: string | null;
    discCategory: string;
  };

  lot: {
    discLotNo: string;
    reportLotNo: string;
    whiteBoxLotNo: string | null;
  };

  markerWellMap: Array<{
    index: number;
    markerNumber: string;
    markerName: string;
    wellNumber: string;
    speciesLine: string;
    speciesName: string;
    used: boolean;
  }>;
};
```

---

## 九、測試 QR

請用以下 QR 字串建立測試：

```text
002505160000120000100009999900000000000000330101022822001058750525994021144701000000031834021224501336180131096023116000336180131096023116000336180131096023116000103404010123160010513705264140211967010000000313520207252000000000313520207252000000000313520207252000000000313520207252001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

---

## 十、Unit Test 要求

請建立：

```text
src/lib/qbiQrParser.test.ts
```

至少測試以下情境：

### 1. 正常 QR 可解析

預期：

```ts
result.ok === true
result.panel.panelName === "Core Chem 13"
result.production.productionDate === "2025-05-16"
result.production.expirationDate === "2026-05-15"
result.lot.discLotNo === "0-001-25051600"
result.lot.reportLotNo === "000125051600"
result.lot.whiteBoxLotNo === "0-905100-25051600"
```

### 2. Marker vs Well 正確

預期 used marker：

```text
Well 01 = Marker 033 = UCRE = Dog
Well 04 = Marker 034 = UPRO = Dog
```

測試條件：

```ts
const usedMarkers = result.markerWellMap.filter(x => x.used);
expect(usedMarkers).toHaveLength(2);
expect(usedMarkers[0]).toMatchObject({
  markerNumber: "033",
  markerName: "UCRE",
  wellNumber: "01",
  speciesName: "Dog",
  used: true,
});
expect(usedMarkers[1]).toMatchObject({
  markerNumber: "034",
  markerName: "UPRO",
  wellNumber: "04",
  speciesName: "Dog",
  used: true,
});
```

### 3. QR 長度大於 1173

- 只解析前 1173 碼
- `raw.extraTail` 有值
- `warnings` 有提示

### 4. QR 長度小於 1173

- 盡量解析可解析欄位
- `warnings` 有提示

### 5. QR 包含非數字

- `ok = false`
- `errors` 有提示

### 6. markerNumber = 000

- `used = false`

### 7. unknown markerNumber

- `markerName = "Unknown Marker"`

---

## 十一、品質要求

1. TypeScript 型別要清楚。
2. Parser 不可依賴 React、DOM、browser API。
3. Parser 必須是純函式，方便未來前端、後端共用。
4. 所有 slice index 請加註解，說明 1-based 對應位置。
5. 錯誤與警告要清楚。
6. panelMap / markerMap 要容易擴充。
7. 不要把規則寫死在 UI component。
8. 不要在本任務實作掃描器、畫面、API 或 DB。

---

## 十二、完成後請回報

請回報：

1. 新增 / 修改哪些檔案
2. 測試如何執行
3. 測試結果
4. 若有任何你認為規則不明確的地方，請列出
