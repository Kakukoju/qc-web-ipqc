export type PanelInfo = {
  panelName: string;
  panelNameCn: string;
  productCode: string | null;
  onePieceBoxPanelType: string;
  subPanelType: string;
  discCategory: string;
  discCategoryZh: string;
  markerList: string[];
  labelVersion: string;
};

export const PANEL_MAP: Record<string, PanelInfo> = {
  "00-001": {
    "panelName": "Core Chem 13",
    "panelNameCn": "核心生化 13",
    "productCode": "905-100",
    "onePieceBoxPanelType": "000001",
    "subPanelType": "001",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "TP",
      "ALB",
      "ALT",
      "ALP"
    ],
    "labelVersion": "V1.0"
  },
  "00-051": {
    "panelName": "Diagnosis Plus 27",
    "panelNameCn": "加強诊断 27",
    "productCode": "905-101",
    "onePieceBoxPanelType": "051052",
    "subPanelType": "051",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "ALT",
      "ALP",
      "GGT",
      "TBIL",
      "AMY",
      "CHOL"
    ],
    "labelVersion": "V1.0"
  },
  "00-052": {
    "panelName": "Diagnosis Plus 27",
    "panelNameCn": "加強诊断 27",
    "productCode": "905-101",
    "onePieceBoxPanelType": "051052",
    "subPanelType": "052",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "ALT",
      "ALP",
      "GGT",
      "TBIL",
      "AMY",
      "CHOL"
    ],
    "labelVersion": "V1.0"
  },
  "00-053": {
    "panelName": "General Chem 26",
    "panelNameCn": "常规生化 26",
    "productCode": "905-102",
    "onePieceBoxPanelType": "053054",
    "subPanelType": "053",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "AMY",
      "CK",
      "CHOL"
    ],
    "labelVersion": "V1.0"
  },
  "00-054": {
    "panelName": "General Chem 26",
    "panelNameCn": "常规生化 26",
    "productCode": "905-102",
    "onePieceBoxPanelType": "053054",
    "subPanelType": "054",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "AMY",
      "CK",
      "CHOL"
    ],
    "labelVersion": "V1.0"
  },
  "00-091": {
    "panelName": "Optimum Wellness 37",
    "panelNameCn": "超级健检 37",
    "productCode": "905-103",
    "onePieceBoxPanelType": "091092000093",
    "subPanelType": "091",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG",
      "CK"
    ],
    "labelVersion": "V1.0"
  },
  "00-092": {
    "panelName": "Optimum Wellness 37",
    "panelNameCn": "超级健检 37",
    "productCode": "905-103",
    "onePieceBoxPanelType": "091092000093",
    "subPanelType": "092",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG",
      "CK"
    ],
    "labelVersion": "V1.0"
  },
  "00-093": {
    "panelName": "Optimum Wellness 37",
    "panelNameCn": "超级健检 37",
    "productCode": "905-103",
    "onePieceBoxPanelType": "091092000093",
    "subPanelType": "093",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG",
      "CK"
    ],
    "labelVersion": "V1.0"
  },
  "00-055": {
    "panelName": "Renal 26",
    "panelNameCn": "肾功能检查 26",
    "productCode": "905-104",
    "onePieceBoxPanelType": "055056",
    "subPanelType": "055",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "ALP"
    ],
    "labelVersion": "Not found"
  },
  "00-056": {
    "panelName": "Renal 26",
    "panelNameCn": "肾功能检查 26",
    "productCode": "905-104",
    "onePieceBoxPanelType": "055056",
    "subPanelType": "056",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "ALP"
    ],
    "labelVersion": "Not found"
  },
  "00-007": {
    "panelName": "Renal 15",
    "panelNameCn": "肾功能检查 15",
    "productCode": "905-121",
    "onePieceBoxPanelType": "000007",
    "subPanelType": "007",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "TP",
      "ALB"
    ],
    "labelVersion": "V1.0"
  },
  "00-065": {
    "panelName": "Liver 23",
    "panelNameCn": "肝功能检查 23",
    "productCode": "905-105",
    "onePieceBoxPanelType": "065066",
    "subPanelType": "065",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG"
    ],
    "labelVersion": "Not found"
  },
  "00-066": {
    "panelName": "Liver 23",
    "panelNameCn": "肝功能检查 23",
    "productCode": "905-105",
    "onePieceBoxPanelType": "065066",
    "subPanelType": "066",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "TP",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG"
    ],
    "labelVersion": "Not found"
  },
  "00-002": {
    "panelName": "Liver 11",
    "panelNameCn": "肝功能检查 11",
    "productCode": "905-122",
    "onePieceBoxPanelType": "000002",
    "subPanelType": "002",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "ALB",
      "ALT",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "BA"
    ],
    "labelVersion": "V1.0"
  },
  "00-006": {
    "panelName": "Liver add-on 10",
    "panelNameCn": "肝功能补充片 10",
    "productCode": "905-120",
    "onePieceBoxPanelType": "000006",
    "subPanelType": "006",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "AST",
      "GGT",
      "TBIL",
      "BA",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG"
    ],
    "labelVersion": "V1.0"
  },
  "00-057": {
    "panelName": "Critical Care 26",
    "panelNameCn": "危重症 26",
    "productCode": "905-106",
    "onePieceBoxPanelType": "057058",
    "subPanelType": "057",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "ALP",
      "CK",
      "LAC"
    ],
    "labelVersion": "V1.0"
  },
  "00-058": {
    "panelName": "Critical Care 26",
    "panelNameCn": "危重症 26",
    "productCode": "905-106",
    "onePieceBoxPanelType": "057058",
    "subPanelType": "058",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "TP",
      "ALB",
      "ALT",
      "ALP",
      "CK",
      "LAC"
    ],
    "labelVersion": "V1.0"
  },
  "00-061": {
    "panelName": "Critical Care add-on 10",
    "panelNameCn": "危重症补充片 10",
    "productCode": "905-121",
    "onePieceBoxPanelType": "061062",
    "subPanelType": "061",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "CK",
      "LAC"
    ],
    "labelVersion": "V1.0"
  },
  "00-062": {
    "panelName": "Critical Care add-on 10",
    "panelNameCn": "危重症补充片 10",
    "productCode": "905-121",
    "onePieceBoxPanelType": "061062",
    "subPanelType": "062",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "Ca",
      "Na",
      "K",
      "Cl",
      "TCO2",
      "CK",
      "LAC"
    ],
    "labelVersion": "V1.0"
  },
  "00-003": {
    "panelName": "Electrolyte 7",
    "panelNameCn": "电解质 7",
    "productCode": "905-107",
    "onePieceBoxPanelType": "000003",
    "subPanelType": "003",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "Na",
      "K",
      "Cl",
      "TCO2"
    ],
    "labelVersion": "V1.0"
  },
  "00-059": {
    "panelName": "Equine 26",
    "panelNameCn": "马匹健检 26",
    "productCode": "905-108",
    "onePieceBoxPanelType": "059060",
    "subPanelType": "059",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "CK",
      "LDH"
    ],
    "labelVersion": "V1.0"
  },
  "00-060": {
    "panelName": "Equine 26",
    "panelNameCn": "马匹健检 26",
    "productCode": "905-108",
    "onePieceBoxPanelType": "059060",
    "subPanelType": "060",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "CREA",
      "BUN",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "AST",
      "ALP",
      "GGT",
      "TBIL",
      "CK",
      "LDH"
    ],
    "labelVersion": "V1.0"
  },
  "00-004": {
    "panelName": "Exotic Pets 13",
    "panelNameCn": "异宠常规 13",
    "productCode": "905-110",
    "onePieceBoxPanelType": "000004",
    "subPanelType": "004",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "URIC",
      "PHOS",
      "Ca",
      "TP",
      "ALB",
      "AST",
      "CK"
    ],
    "labelVersion": "V1.0"
  },
  "00-063": {
    "panelName": "Avian & Reptile 26",
    "panelNameCn": "异宠全套 26",
    "productCode": "905-111",
    "onePieceBoxPanelType": "063064",
    "subPanelType": "063",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "BUN",
      "URIC",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "AST",
      "ALP",
      "GGT",
      "BA",
      "CHOL",
      "CK",
      "LDH"
    ],
    "labelVersion": "V1.1"
  },
  "00-064": {
    "panelName": "Avian & Reptile 26",
    "panelNameCn": "异宠全套 26",
    "productCode": "905-111",
    "onePieceBoxPanelType": "063064",
    "subPanelType": "064",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "BUN",
      "URIC",
      "PHOS",
      "Ca",
      "Na",
      "K",
      "TP",
      "ALB",
      "AST",
      "ALP",
      "GGT",
      "BA",
      "CHOL",
      "CK",
      "LDH"
    ],
    "labelVersion": "V1.1"
  },
  "00-005": {
    "panelName": "Diabetes 10",
    "panelNameCn": "糖尿病 10",
    "productCode": "905-112",
    "onePieceBoxPanelType": "000005",
    "subPanelType": "005",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "FRU",
      "TP",
      "ALB",
      "AMY",
      "P-LIPA",
      "CHOL",
      "TRIG"
    ],
    "labelVersion": "V1.0"
  },
  "00-033": {
    "panelName": "Pancreatitis 9",
    "panelNameCn": "胰腺炎 9",
    "productCode": "905-113",
    "onePieceBoxPanelType": "000033",
    "subPanelType": "033",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "BUN",
      "Na",
      "K",
      "ALT",
      "GGT",
      "P-LIPA",
      "TRIG",
      "LAC"
    ],
    "labelVersion": "Not found"
  },
  "00-031": {
    "panelName": "Specific Test 1",
    "panelNameCn": "特定测项1",
    "productCode": "905-114",
    "onePieceBoxPanelType": "000031",
    "subPanelType": "031",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "NH3"
    ],
    "labelVersion": "V1.0"
  },
  "00-032": {
    "panelName": "Specific Test 2",
    "panelNameCn": "特定测项2",
    "productCode": "905-115",
    "onePieceBoxPanelType": "000032",
    "subPanelType": "032",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "A: BUN",
      "CREA",
      "B: GLU",
      "TP",
      "ALB"
    ],
    "labelVersion": "V1.0"
  },
  "00-034": {
    "panelName": "Specific Test 4",
    "panelNameCn": "特定测项4",
    "productCode": "905-117",
    "onePieceBoxPanelType": "000034",
    "subPanelType": "034",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "A: ALP",
      "ALT",
      "AST",
      "B: Ca",
      "PHOS",
      "Mg"
    ],
    "labelVersion": "V1.0"
  },
  "00-035": {
    "panelName": "Specific Test 5",
    "panelNameCn": "特定测项5",
    "productCode": "905-118",
    "onePieceBoxPanelType": "000035",
    "subPanelType": "035",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "TRIG",
      "CHOL",
      "GLU"
    ],
    "labelVersion": "V1.0"
  },
  "00-036": {
    "panelName": "Specific Test 6",
    "panelNameCn": "特定测项6",
    "productCode": "905-119",
    "onePieceBoxPanelType": "000036",
    "subPanelType": "036",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "GLU",
      "FRU"
    ],
    "labelVersion": "Not found"
  },
  "00-037": {
    "panelName": "Specific Test 6",
    "panelNameCn": "特定测项6",
    "productCode": "905-123",
    "onePieceBoxPanelType": "000037",
    "subPanelType": "037",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "P-LIPA",
      "AMY"
    ],
    "labelVersion": "Not found"
  },
  "10-106": {
    "panelName": "Canine CRP",
    "panelNameCn": "犬C反应蛋白",
    "productCode": "905-201",
    "onePieceBoxPanelType": "000106",
    "subPanelType": "106",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "cCRP"
    ],
    "labelVersion": "V1.0"
  },
  "10-107": {
    "panelName": "Serum Amyloid A",
    "panelNameCn": "血清淀粉样蛋白A",
    "productCode": "905-202",
    "onePieceBoxPanelType": "000107",
    "subPanelType": "107",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "SAA"
    ],
    "labelVersion": "V1.0"
  },
  "10-108": {
    "panelName": "Phenobarbital",
    "panelNameCn": "苯巴比妥",
    "productCode": "905-203",
    "onePieceBoxPanelType": "000108",
    "subPanelType": "108",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "PHBR"
    ],
    "labelVersion": "V1.0"
  },
  "10-113": {
    "panelName": "S-DMA",
    "panelNameCn": "S-DMA",
    "productCode": "905-204",
    "onePieceBoxPanelType": "000113",
    "subPanelType": "113",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "S-DMA"
    ],
    "labelVersion": "V1.0"
  },
  "10-101": {
    "panelName": "Total T4",
    "panelNameCn": "总甲状腺素",
    "productCode": "905-205",
    "onePieceBoxPanelType": "000101",
    "subPanelType": "101",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "TT4"
    ],
    "labelVersion": "V1.0"
  },
  "20-102": {
    "panelName": "Canine TSH",
    "panelNameCn": "犬促甲状腺激素",
    "productCode": "905-206",
    "onePieceBoxPanelType": "000102",
    "subPanelType": "102",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "cTSH"
    ],
    "labelVersion": "V1.0"
  },
  "20-103": {
    "panelName": "Canine Progesterone",
    "panelNameCn": "犬孕酮",
    "productCode": "905-207",
    "onePieceBoxPanelType": "000103",
    "subPanelType": "103",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "cPROG"
    ],
    "labelVersion": "V1.0"
  },
  "20-104": {
    "panelName": "Canine Cortisol",
    "panelNameCn": "犬皮质醇",
    "productCode": "905-208",
    "onePieceBoxPanelType": "000104",
    "subPanelType": "104",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "cCORT"
    ],
    "labelVersion": "V1.0"
  },
  "20-109": {
    "panelName": "Canine Pancreas-specific Lipase",
    "panelNameCn": "犬胰腺特异性脂肪酶",
    "productCode": "905-209",
    "onePieceBoxPanelType": "000109",
    "subPanelType": "109",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "cPL"
    ],
    "labelVersion": "V1.0"
  },
  "20-110": {
    "panelName": "Feline Pancreas-specific Lipase",
    "panelNameCn": "猫胰腺特异性脂肪酶",
    "productCode": "905-210",
    "onePieceBoxPanelType": "000110",
    "subPanelType": "110",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "fPL"
    ],
    "labelVersion": "V1.0"
  },
  "20-111": {
    "panelName": "Canine NT-proBNP",
    "panelNameCn": "犬N端脑钠肽前体",
    "productCode": "905-211",
    "onePieceBoxPanelType": "000111",
    "subPanelType": "111",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "cNTpBNP"
    ],
    "labelVersion": "V1.0"
  },
  "20-112": {
    "panelName": "Feline NT-proBNP",
    "panelNameCn": "猫N端脑钠肽前体",
    "productCode": "905-212",
    "onePieceBoxPanelType": "000112",
    "subPanelType": "112",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "fNTpBNP"
    ],
    "labelVersion": "V1.0"
  },
  "20-114": {
    "panelName": "Cardiac Troponin I",
    "panelNameCn": "心脏肌钙蛋白-I",
    "productCode": "905-213",
    "onePieceBoxPanelType": "000114",
    "subPanelType": "114",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "CTn-I"
    ],
    "labelVersion": "V1.0"
  },
  "20-115": {
    "panelName": "Nucleosome Histone 3.1",
    "panelNameCn": "核小体组蛋白 H3.1",
    "productCode": "905-214",
    "onePieceBoxPanelType": "000115",
    "subPanelType": "115",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "Nu-H3.1"
    ],
    "labelVersion": "V1.0"
  },
  "30-301": {
    "panelName": "Coagulation",
    "panelNameCn": "凝血检查",
    "productCode": "905-300",
    "onePieceBoxPanelType": "000301",
    "subPanelType": "301",
    "discCategory": "GOAG",
    "discCategoryZh": "凝血",
    "markerList": [
      "Canine: PT",
      "APTT",
      "FIB",
      "Feline: PT",
      "APTT",
      "Equine: PT",
      "FIB"
    ],
    "labelVersion": "905-300"
  },
  "40-401": {
    "panelName": "Dx4",
    "panelNameCn": "犬4合1",
    "productCode": "905-400",
    "onePieceBoxPanelType": "000401",
    "subPanelType": "401",
    "discCategory": "Rapid Test",
    "discCategoryZh": "快篩",
    "markerList": [
      "HW Ag",
      "Lyme Ab",
      "Ehrlich Ab",
      "Anaplasma Ab"
    ],
    "labelVersion": "Not found"
  },
  "40-402": {
    "panelName": "Canine Dx4-Leish",
    "panelNameCn": "犬4合1-利什曼原虫",
    "productCode": "905-401",
    "onePieceBoxPanelType": "000402",
    "subPanelType": "402",
    "discCategory": "Rapid Test",
    "discCategoryZh": "快篩",
    "markerList": [
      "HW Ag",
      "LSH Ag (Leishmania)",
      "Ehrlich Ab",
      "Anaplasma Ab"
    ],
    "labelVersion": "Not found"
  },
  "40-403": {
    "panelName": "Feline Dx3",
    "panelNameCn": "猫3合1",
    "productCode": "905-402",
    "onePieceBoxPanelType": "000403",
    "subPanelType": "403",
    "discCategory": "Rapid Test",
    "discCategoryZh": "快篩",
    "markerList": [
      "HW Ab",
      "FIV Ab",
      "FeLV Ag"
    ],
    "labelVersion": "Not found"
  },
  "40-404": {
    "panelName": "Canine Dx4-B",
    "panelNameCn": "犬4合1-犬巴贝虫",
    "productCode": "905-403",
    "onePieceBoxPanelType": "000404",
    "subPanelType": "404",
    "discCategory": "Rapid Test",
    "discCategoryZh": "快篩",
    "markerList": [
      "HW Ag",
      "Babesia Ab",
      "Ehrlich Ab",
      "Anaplasma Ab"
    ],
    "labelVersion": "Not found"
  },
  "00-040": {
    "panelName": "Urine Protein CREA ratio",
    "panelNameCn": "UPC 尿蛋白/肌酐比值",
    "productCode": "905-501",
    "onePieceBoxPanelType": "000040",
    "subPanelType": "040",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "UPC"
    ],
    "labelVersion": "V1.0"
  },
  "10-141": {
    "panelName": "Urine Microalbumin",
    "panelNameCn": "尿微量白蛋白",
    "productCode": "905-502",
    "onePieceBoxPanelType": "000141",
    "subPanelType": "141",
    "discCategory": "Immuno-T",
    "discCategoryZh": "免疫比濁",
    "markerList": [
      "UmALB"
    ],
    "labelVersion": "Not found"
  },
  "00-041": {
    "panelName": "UCCR (Urine Cortisol CREA ratio)",
    "panelNameCn": "UCCR 尿皮质醇/肌酐比值",
    "productCode": "905-503",
    "onePieceBoxPanelType": "041122",
    "subPanelType": "041",
    "discCategory": "CHEM",
    "discCategoryZh": "生化",
    "markerList": [
      "UCCR",
      "UPC",
      "UCORT",
      "UPRO",
      "UCRE"
    ],
    "labelVersion": "Not found"
  },
  "20-122": {
    "panelName": "UCCR (Urine Cortisol CREA ratio)",
    "panelNameCn": "UCCR 尿皮质醇/肌酐比值",
    "productCode": "905-503",
    "onePieceBoxPanelType": "041122",
    "subPanelType": "122",
    "discCategory": "Immuno-E",
    "discCategoryZh": "ELISA",
    "markerList": [
      "UCCR",
      "UPC",
      "UCORT",
      "UPRO",
      "UCRE"
    ],
    "labelVersion": "Not found"
  },
  "50-501": {
    "panelName": "Vector-Borne Panel 7",
    "panelNameCn": "病媒疾病检测套组",
    "productCode": "905-600",
    "onePieceBoxPanelType": "000501",
    "subPanelType": "501",
    "discCategory": "PCR(RPA)",
    "discCategoryZh": "PCR(RPA)",
    "markerList": [
      "Leish spp.",
      "Babesia Canis",
      "Babesia Gibsoni",
      "Canine Hemotropic Mycoplasma (CHM) spp.",
      "Bartonella spp.",
      "Ehrlichia spp.",
      "Anaplasma spp."
    ],
    "labelVersion": "Not found"
  },
  "50-503": {
    "panelName": "Ehrl. Anap.",
    "panelNameCn": "埃利希体,无形体",
    "productCode": "905-601",
    "onePieceBoxPanelType": "000503",
    "subPanelType": "503",
    "discCategory": "PCR(RPA)",
    "discCategoryZh": "PCR(RPA)",
    "markerList": [
      "2項 :  Ehrlich spp.",
      "Anaplasma spp."
    ],
    "labelVersion": "Not found"
  },
  "50-504": {
    "panelName": "Leishmaniasis spp.",
    "panelNameCn": "利什曼原虫",
    "productCode": "905-602",
    "onePieceBoxPanelType": "000504",
    "subPanelType": "504",
    "discCategory": "PCR(RPA)",
    "discCategoryZh": "PCR(RPA)",
    "markerList": [
      "1項 :  Leish spp."
    ],
    "labelVersion": "Not found"
  },
  "50-505": {
    "panelName": "Babesia Type",
    "panelNameCn": "巴贝斯虫类型",
    "productCode": "905-603",
    "onePieceBoxPanelType": "000505",
    "subPanelType": "505",
    "discCategory": "PCR(RPA)",
    "discCategoryZh": "PCR(RPA)",
    "markerList": [
      "2項 :  Babesia Canis spp.",
      "Babesia Gibsoni"
    ],
    "labelVersion": "Not found"
  },
  "90-904": {
    "panelName": "Neutral density NG04",
    "panelNameCn": "巴贝斯虫类型",
    "productCode": "905-603",
    "onePieceBoxPanelType": "000904",
    "subPanelType": "904",
    "discCategory": "校正盤 Disc",
    "discCategoryZh": "校正盤 Disc",
    "markerList": [
      "2項 :  Babesia Canis spp.",
      "Babesia Gibsoni"
    ],
    "labelVersion": "Not found"
  },
  "90-905": {
    "panelName": "Neutral density NG05",
    "panelNameCn": "巴贝斯虫类型",
    "productCode": "905-603",
    "onePieceBoxPanelType": "000905",
    "subPanelType": "905",
    "discCategory": "校正盤 Disc",
    "discCategoryZh": "校正盤 Disc",
    "markerList": [
      "2項 :  Babesia Canis spp.",
      "Babesia Gibsoni"
    ],
    "labelVersion": "Not found"
  },
  "90-909": {
    "panelName": "Neutral density NG09",
    "panelNameCn": "巴贝斯虫类型",
    "productCode": "905-603",
    "onePieceBoxPanelType": "000909",
    "subPanelType": "909",
    "discCategory": "校正盤 Disc",
    "discCategoryZh": "校正盤 Disc",
    "markerList": [
      "2項 :  Babesia Canis spp.",
      "Babesia Gibsoni"
    ],
    "labelVersion": "Not found"
  },
  "90-911": {
    "panelName": "Neutral density NG11",
    "panelNameCn": "巴贝斯虫类型",
    "productCode": "905-603",
    "onePieceBoxPanelType": "000911",
    "subPanelType": "911",
    "discCategory": "校正盤 Disc",
    "discCategoryZh": "校正盤 Disc",
    "markerList": [
      "2項 :  Babesia Canis spp.",
      "Babesia Gibsoni"
    ],
    "labelVersion": "Not found"
  }
};
