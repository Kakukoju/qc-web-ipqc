import { RotateCcw, Search } from 'lucide-react';
import type { Logic, PanelNameOption, QueryCondition } from '../api';
import LogicSwitch from './LogicSwitch';

interface QueryPanelProps {
  headers: string[];
  panelNames: PanelNameOption[];
  conditions: QueryCondition[];
  logic: Logic;
  loading: boolean;
  onConditionChange: (index: number, condition: QueryCondition) => void;
  onLogicChange: (logic: Logic) => void;
  onSearch: () => void;
  onClear: () => void;
}

export default function QueryPanel({
  headers,
  panelNames,
  conditions,
  logic,
  loading,
  onConditionChange,
  onLogicChange,
  onSearch,
  onClear,
}: QueryPanelProps) {
  return (
    <section className="query-panel" aria-label="查詢條件">
      <div className="query-grid">
        {conditions.map((condition, index) => (
          <div className="query-row" key={index}>
            <label>查詢項目 {index + 1}</label>
            <select
              value={condition.header}
              onChange={(event) =>
                onConditionChange(index, { ...condition, header: event.target.value, value: '' })
              }
            >
              <option value="">請選擇欄位</option>
              {headers.map((header) => (
                <option value={header} key={header}>
                  {header}
                </option>
              ))}
            </select>
            {condition.header === 'panel_name' ? (
              <select
                value={condition.value}
                onChange={(event) =>
                  onConditionChange(index, { ...condition, value: event.target.value })
                }
              >
                <option value="">請選擇 Panel</option>
                {panelNames.map((opt) => (
                  <option value={`${opt.value}||${opt.value_cn}`} key={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={condition.value}
                placeholder="輸入查詢值"
                onChange={(event) =>
                  onConditionChange(index, { ...condition, value: event.target.value })
                }
              />
            )}
          </div>
        ))}
      </div>

      <div className="query-actions">
        <LogicSwitch value={logic} onChange={onLogicChange} />
        <button className="secondary-button" type="button" onClick={onClear}>
          <RotateCcw size={16} />
          清除條件
        </button>
        <button className="primary-button" type="button" onClick={onSearch} disabled={loading}>
          <Search size={16} />
          {loading ? '查詢中' : '查詢'}
        </button>
      </div>
    </section>
  );
}
