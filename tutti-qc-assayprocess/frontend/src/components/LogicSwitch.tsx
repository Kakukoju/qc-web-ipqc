import type { Logic } from '../api';

interface LogicSwitchProps {
  value: Logic;
  onChange: (value: Logic) => void;
}

export default function LogicSwitch({ value, onChange }: LogicSwitchProps) {
  return (
    <div className="logic-switch" role="group" aria-label="查詢邏輯">
      <button
        type="button"
        className={value === 'AND' ? 'active' : ''}
        onClick={() => onChange('AND')}
      >
        AND
      </button>
      <button
        type="button"
        className={value === 'OR' ? 'active' : ''}
        onClick={() => onChange('OR')}
      >
        OR
      </button>
      <span className={`logic-thumb ${value === 'OR' ? 'right' : ''}`} />
    </div>
  );
}
