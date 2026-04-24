import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '../../api/base';
import {
  LayoutDashboard, FlaskConical, AlertTriangle,
  BarChart3, Settings, ChevronRight,
  Activity, Microscope
} from 'lucide-react';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  id: string;
  badge?: number;
}

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
}


export default function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const load = () => fetch(apiUrl('/schedule/pending-inspection'))
      .then(r => r.json()).then(d => setPendingCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const items: NavItem[] = [
    { icon: <LayoutDashboard size={18} />, label: 'Dashboard', id: 'dashboard' },
    { icon: <Activity size={18} />, label: '生產管理', id: 'production' },
    { icon: <FlaskConical size={18} />, label: 'IPQC 管理', id: 'qc' },
    { icon: <Microscope size={18} />, label: 'IPQC 工作台', id: 'ipqc', badge: pendingCount || undefined },
    { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="20" x2="3" y2="4" /><line x1="3" y1="20" x2="21" y2="20" /><path d="M4 16 Q10 4 20 6" /></svg>, label: 'Tutti-Beads 預建線', id: 'monitor' },
    { icon: <AlertTriangle size={18} />, label: '異常管理', id: 'anomaly' },
    { icon: <BarChart3 size={18} />, label: '報表分析', id: 'reports' },
    { icon: <Settings size={18} />, label: '系統設定', id: 'settings' },
  ];

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="flex flex-col h-full border-r border-[#2A3754] bg-[#0B1220] overflow-hidden shrink-0"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-[#2A3754]">
        <div className="w-8 h-8 rounded-lg bg-[#00D4AA] flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B1220" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* 座標軸 */}
            <line x1="3" y1="21" x2="3" y2="3" />
            <line x1="3" y1="21" x2="21" y2="21" />
            {/* 散點 */}
            <circle cx="7" cy="17" r="1.2" fill="#0B1220" />
            <circle cx="9" cy="14" r="1.2" fill="#0B1220" />
            <circle cx="12" cy="13" r="1.2" fill="#0B1220" />
            <circle cx="15" cy="10" r="1.2" fill="#0B1220" />
            <circle cx="18" cy="7" r="1.2" fill="#0B1220" />
            {/* 線性回歸線 */}
            <line x1="5" y1="19" x2="20" y2="5" stroke="#FF3B3B" strokeDasharray="3 1.5" />
          </svg>
        </div>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-sm font-semibold text-[#EAF2FF] leading-tight"
          >
            Automatic Baseline<br />Assignment
          </motion.span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-1 px-2">
        {items.map((item) => {
          const isActive = activeView === item.id;
          return (
            <motion.button
              key={item.id}
              whileHover={{ x: 2 }}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors relative ${
                isActive
                  ? 'bg-[#00D4AA]/10 text-[#00D4AA]'
                  : 'text-[#93A4C3] hover:text-[#EAF2FF] hover:bg-[#1A2438]'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <span className="whitespace-nowrap flex-1 text-left">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="bg-[#FF5C73] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                  {item.badge}
                </span>
              )}
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#00D4AA] rounded-r-full"
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center p-4 border-t border-[#2A3754] text-[#93A4C3] hover:text-[#EAF2FF]"
      >
        <motion.div animate={{ rotate: collapsed ? 0 : 180 }}>
          <ChevronRight size={16} />
        </motion.div>
      </button>
    </motion.aside>
  );
}
