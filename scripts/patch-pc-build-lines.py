#!/usr/bin/env python3
"""Patch the PC pre-assignment build-lines page to add '建線送 RD' button."""
import os

PC_PAGE = "/home/ubuntu/pre-assignment/pc/src/pages/AssayProcessBaselinePage.tsx"
API_FILE = "/home/ubuntu/pre-assignment/pc/src/api/rdBuildLine.ts"

# 1. Create the API helper file
api_content = '''/**
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
'''

os.makedirs(os.path.dirname(API_FILE), exist_ok=True)
with open(API_FILE, 'w') as f:
    f.write(api_content)
print(f"✅ Created {API_FILE}")

# 2. Patch the page
with open(PC_PAGE, 'r') as f:
    content = f.read()

if 'sendToRd' in content:
    print("✅ Already patched")
    exit(0)

# Add import
content = content.replace(
    "import './assay-baseline.css';",
    "import './assay-baseline.css';\nimport { createRdBuildLineTask } from '../api/rdBuildLine';"
)

# Add state variables after message state
content = content.replace(
    "const [message, setMessage] = useState('');",
    """const [message, setMessage] = useState('');
  const [rdSending, setRdSending] = useState(false);
  const [rdResult, setRdResult] = useState<{ok: boolean; message: string} | null>(null);"""
)

# Add sendToRd function before "const columns = result"
send_fn = '''
  const sendToRd = async () => {
    const c1 = conditions[0];
    const c2 = conditions[1];
    if (!c1?.value || !c2?.value) {
      setMessage('請先設定 panel_name 與 analyze_date 查詢條件');
      return;
    }
    const panelName = c1.value.split('||')[0];
    const lotNo = c2.value;
    setRdSending(true);
    try {
      const resp = await createRdBuildLineTask({
        panel_name: panelName,
        lot_no: lotNo,
        created_by: 'PC Build-Lines',
      });
      if (resp.ok) {
        const msg = resp.data?.existing
          ? `此筆已在 RD 待建線清單中 (ID: ${resp.data.task_id})`
          : `已送出 RD 建線任務 · ${panelName} / ${lotNo}`;
        setRdResult({ ok: true, message: msg });
      } else {
        setRdResult({ ok: false, message: resp.error?.message || '送出失敗' });
      }
    } catch {
      setRdResult({ ok: false, message: '網路錯誤' });
    } finally {
      setRdSending(false);
      setTimeout(() => setRdResult(null), 5000);
    }
  };

'''
content = content.replace(
    "  const columns = result",
    send_fn + "  const columns = result"
)

# Add button in header-actions (after RefreshCw button)
content = content.replace(
    '''<button className="icon-button" type="button" onClick={loadHeaders} title="重新載入欄位">
            <RefreshCw size={17} />
            </button>''',
    '''<button className="icon-button" type="button" onClick={loadHeaders} title="重新載入欄位">
            <RefreshCw size={17} />
            </button>
            <button className="primary-button" type="button" onClick={sendToRd} disabled={rdSending} title="建線送 RD" style={{marginLeft: 8}}>
              {rdSending ? '送出中...' : '建線送 RD'}
            </button>'''
)

# Also try alternate formatting
if 'sendToRd' not in content.split('onClick={')[1:][0] if 'onClick={' in content else '':
    # Try with different whitespace
    content = content.replace(
        '<RefreshCw size={17} />\n            </button>\n          </div>',
        '''<RefreshCw size={17} />
            </button>
            <button className="primary-button" type="button" onClick={sendToRd} disabled={rdSending} title="建線送 RD" style={{marginLeft: 8}}>
              {rdSending ? '送出中...' : '建線送 RD'}
            </button>
          </div>'''
    )

# Add rdResult display after message
content = content.replace(
    '{message && <div className="message">{message}</div>}',
    '''{message && <div className="message">{message}</div>}
        {rdResult && (
          <div className={`message ${rdResult.ok ? '' : 'error'}`} style={{background: rdResult.ok ? '#D1FAE5' : '#FEE2E2', color: rdResult.ok ? '#065F46' : '#991B1B'}}>
            {rdResult.message}
          </div>
        )}'''
)

with open(PC_PAGE, 'w') as f:
    f.write(content)

print(f"✅ Patched {PC_PAGE}")
print("\nTo rebuild: cd /home/ubuntu/pre-assignment/pc && npx vite build")
