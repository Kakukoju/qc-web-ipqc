# Git 同步流程 (AWS ↔ Windows)

## 架構說明

```
Windows (D:\QC-web\qc-web-app)
        ↕  git push / git pull
    GitHub (Kakukoju/qc-web-ipqc)
        ↕  git push / git pull
AWS (/home/ubuntu/qc-web-ipqc)
```

- **DB** 只在 AWS，不進 git
- **dist/** build 產出，不進 git
- **src/** 原始碼，透過 git 同步

---

## AWS 改完 → 同步到 Windows

### Step 1：AWS 上 commit & push

```bash
cd /home/ubuntu/qc-web-ipqc
qcpush "說明這次改了什麼"
```

> `qcpush` = `git add -A && git commit -m "..." && git push`

### Step 2：Windows 上 pull

```powershell
cd D:\QC-web\qc-web-app
git pull
```

---

## Windows 改完 → 同步到 AWS

### Step 1：Windows 上 commit & push

```powershell
cd D:\QC-web\qc-web-app
git add -A
git commit -m "說明這次改了什麼"
git push
```

### Step 2：AWS 上 pull & build

```bash
cd /home/ubuntu/qc-web-ipqc
git pull
npm run build
```

---

## 改完 src/ 之後一定要 build

```bash
# AWS 上執行
cd /home/ubuntu/qc-web-ipqc
npm run build
```

build 完成後，`dist/` 自動更新，網站立即生效。

---

## 注意事項

| 項目 | 說明 |
|---|---|
| `node_modules/` | 不進 git，第一次在新環境需執行 `npm install` |
| `dist/` | 不進 git，每次改 src/ 後需執行 `npm run build` |
| `.env.production` | 不進 git，參考 `.env.example` 建立 |
| `ipqcdrybeads.db` | 不進 git，只在 AWS，需要時用 `scp` 手動複製 |
| `year-filter-patched.js` | 獨立維護，`npm run build` 不會蓋掉 |

---

## 第一次在新環境設定

```bash
git clone https://github.com/Kakukoju/qc-web-ipqc.git
cd qc-web-ipqc
npm install
cp .env.example .env.production
# 編輯 .env.production 填入正確的路徑
npm run build
```

---

## 常用指令速查

| 指令 | 說明 |
|---|---|
| `qcpush "說明"` | AWS 專用：add + commit + push |
| `git pull` | 從 GitHub 拉取最新版本 |
| `git log --oneline` | 查看 commit 歷史 |
| `git status` | 查看目前有哪些檔案被修改 |
| `npm run build` | 重新 build 前端 |
