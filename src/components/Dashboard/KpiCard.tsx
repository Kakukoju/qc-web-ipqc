import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface KpiCardProps {
  label: string;
  value: number;
  color?: string;
  icon?: React.ReactNode;
  unit?: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
  delay?: number;
}

const variantStyles = {
  default: { border: '#2A3754', glow: '', text: '#EAF2FF', sub: '#93A4C3' },
  warning: { border: '#FFB84D', glow: 'shadow-[0_0_12px_rgba(255,184,77,0.15)]', text: '#FFB84D', sub: '#FFB84D99' },
  danger: { border: '#FF5C73', glow: 'shadow-[0_0_12px_rgba(255,92,115,0.15)]', text: '#FF5C73', sub: '#FF5C7399' },
  success: { border: '#00D4AA', glow: 'shadow-[0_0_12px_rgba(0,212,170,0.15)]', text: '#00D4AA', sub: '#00D4AA99' },
};

export default function KpiCard({ label, value, icon, unit = '', variant = 'default', delay = 0 }: KpiCardProps) {
  const [displayed, setDisplayed] = useState(0);
  const style = variantStyles[variant];

  useEffect(() => {
    const timer = setTimeout(() => {
      let start = 0;
      const step = Math.ceil(value / 20);
      const interval = setInterval(() => {
        start += step;
        if (start >= value) { setDisplayed(value); clearInterval(interval); }
        else setDisplayed(start);
      }, 30);
      return () => clearInterval(interval);
    }, delay * 100);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.08, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={`bg-[#121A2B] rounded-xl p-4 border ${style.glow} cursor-default`}
      style={{ borderColor: style.border }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-[#93A4C3]">{label}</span>
        {icon && <span style={{ color: style.text }}>{icon}</span>}
      </div>
      <div className="flex items-end gap-1">
        <span
          className="text-2xl font-bold tabular-nums count-animate"
          style={{ color: style.text }}
        >
          {displayed.toLocaleString()}
        </span>
        {unit && <span className="text-xs mb-1" style={{ color: style.sub }}>{unit}</span>}
      </div>
    </motion.div>
  );
}
