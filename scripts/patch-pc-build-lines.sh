#!/bin/bash
# Patch the PC pre-assignment build-lines page to add "建線送 RD" button
# This script adds the RD task creation API call to the AssayProcessBaselinePage

PC_PAGE="/home/ubuntu/pre-assignment/pc/src/pages/AssayProcessBaselinePage.tsx"

if [ ! -f "$PC_PAGE" ]; then
  echo "❌ PC build-lines page not found at $PC_PAGE"
  exit 1
fi

# Check if already patched
if grep -q "sendToRd" "$PC_PAGE"; then
  echo "✅ Already patched"
  exit 0
fi

# Create the API helper file
cat > /home/ubuntu/pre-assignment/pc/src/api/rdBuildLine.ts << 'EOF'
/**
 * RD Build-Line Tasks API client
 * Used by PC build-lines page to send tasks to RD mobile
 */
const RD_API_BASE = '/qc-web-api/api/v1/pre-assignment';

export interface CreateRdTaskParams {
  panel_name: string;
  lot_no: string;
  marker?: string;
  work_order?: string;
  source_fit_id?: string;
  created_by?: string;
  fit_data?: Record<string, unknown>;
}

export interface CreateRdTaskResponse {
  ok: boolean;
  data?: { task_id: number; status: string; existing?: boolean };
  message?: string;
  error?: { code: string; message: string };
}

export async function createRdBuildLineTask(params: CreateRdTaskParams): Promise<CreateRdTaskResponse> {
  const res = await fetch(`${RD_API_BASE}/rd-build-line-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
EOF

echo "✅ Created /home/ubuntu/pre-assignment/pc/src/api/rdBuildLine.ts"

# Add import and button to the AssayProcessBaselinePage
# Insert import after the last import line
sed -i '/^import.*assay-baseline.css/a\import { createRdBuildLineTask } from '\''../api/rdBuildLine'\'';' "$PC_PAGE"

# Add state for sendToRd modal after the message state
sed -i '/const \[message, setMessage\] = useState/a\  const [rdSending, setRdSending] = useState(false);\n  const [rdResult, setRdResult] = useState<{ok: boolean; message: string} | null>(null);' "$PC_PAGE"

# Add sendToRd function before the return statement
sed -i '/const columns = result/i\
  const sendToRd = async () => {\
    const c1 = conditions[0];\
    const c2 = conditions[1];\
    if (!c1?.value || !c2?.value) {\
      setMessage("請先設定 panel_name 與 analyze_date 查詢條件");\
      return;\
    }\
    const panelName = c1.value.split("||")[0];\
    const lotNo = c2.value;\
    setRdSending(true);\
    try {\
      const resp = await createRdBuildLineTask({\
        panel_name: panelName,\
        lot_no: lotNo,\
        created_by: "PC Build-Lines",\
      });\
      if (resp.ok) {\
        const msg = resp.data?.existing\
          ? `此筆已在 RD 待建線清單中 (ID: ${resp.data.task_id})`\
          : `已送出 RD 建線任務 · ${panelName} / ${lotNo}`;\
        setRdResult({ ok: true, message: msg });\
      } else {\
        setRdResult({ ok: false, message: resp.error?.message || "送出失敗" });\
      }\
    } catch (e) {\
      setRdResult({ ok: false, message: "網路錯誤" });\
    } finally {\
      setRdSending(false);\
      setTimeout(() => setRdResult(null), 5000);\
    }\
  };' "$PC_PAGE"

# Add the button in the header-actions section
sed -i '/<RefreshCw size={17} \/>/a\
            </button>\
            <button className="primary-button" type="button" onClick={sendToRd} disabled={rdSending} title="建線送 RD">\
              {rdSending ? "送出中..." : "建線送 RD"}\
            </button>\
            {rdResult \&\& (\
              <span className={`rd-result-badge ${rdResult.ok ? "success" : "error"}`}>\
                {rdResult.message}\
              </span>\
            )}' "$PC_PAGE"

echo "✅ Patched $PC_PAGE with 建線送 RD button"
echo ""
echo "To rebuild the PC pre-assignment project:"
echo "  cd /home/ubuntu/pre-assignment/pc && npm run build"
