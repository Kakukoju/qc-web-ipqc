export type DiscTypeInfo = {
  categoryName: string;
  categoryNameZh: string;
  discTypeNo: string;
};

export const DISC_TYPE_MAP: Record<string, DiscTypeInfo> = {
  "10": {
    "categoryName": "Immuno-T",
    "categoryNameZh": "免疫比濁",
    "discTypeNo": "1"
  },
  "20": {
    "categoryName": "Immuno-E",
    "categoryNameZh": "ELISA",
    "discTypeNo": "2"
  },
  "30": {
    "categoryName": "GOAG",
    "categoryNameZh": "凝血",
    "discTypeNo": "3"
  },
  "40": {
    "categoryName": "Rapid Test",
    "categoryNameZh": "快篩",
    "discTypeNo": "4"
  },
  "50": {
    "categoryName": "PCR(RPA)",
    "categoryNameZh": "PCR(RPA)",
    "discTypeNo": "5"
  },
  "60": {
    "categoryName": "血氣",
    "categoryNameZh": "血氣",
    "discTypeNo": "6"
  },
  "70": {
    "categoryName": "NH3",
    "categoryNameZh": "NH3",
    "discTypeNo": "7"
  },
  "90": {
    "categoryName": "校正盤 Disc",
    "categoryNameZh": "校正盤 Disc",
    "discTypeNo": "9"
  },
  "00": {
    "categoryName": "CHEM",
    "categoryNameZh": "生化",
    "discTypeNo": "0"
  }
};
