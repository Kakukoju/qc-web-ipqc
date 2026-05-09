import { Bell, User, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiUrl } from '../../api/base';

interface Notification {
  bead_name: string;
  sheet_name: string;
  insp_date: string | null;
  reason: string | null;
  source: string;
}

interface TopbarProps {
  title?: string;
  onNavigate?: (marker: string, sheet: string) => void;
}

export default function Topbar({ title = 'IPQC 管理儀表', onNavigate }: TopbarProps) {
  const [showNotify, setShowNotify] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    fetch(apiUrl('/drbeads/notifications'))
      .then(r => r.ok ? r.json() : [])
      .then(setNotifications)
      .catch(() => {});
  }, []);

  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-[#2A3754] bg-[#0B1220] shrink-0">
      <span className="text-sm font-medium text-[#93A4C3]">{title}</span>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowNotify(!showNotify)}
            className="relative p-2 rounded-lg hover:bg-[#1A2438] text-[#93A4C3] hover:text-[#EAF2FF] transition-colors"
          >
            <Bell size={16} />
            {notifications.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF5C73] rounded-full" />
            )}
          </motion.button>
          <AnimatePresence>
            {showNotify && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                className="absolute right-0 top-10 w-80 bg-[#121A2B] border border-[#2A3754] rounded-xl shadow-xl z-50 p-3 max-h-80 overflow-y-auto"
              >
                <p className="text-xs text-[#93A4C3] mb-2 px-1">最新通知（今日）</p>
                {notifications.length === 0 ? (
                  <p className="text-xs text-[#3A5070] text-center py-4">今日無異常 🎉</p>
                ) : (
                  notifications.map((n, i) => (
                    <div key={i}
                      onClick={() => { onNavigate?.(n.bead_name, n.sheet_name); setShowNotify(false); }}
                      className="flex gap-2 px-1 py-2 hover:bg-[#1A2438] rounded-lg cursor-pointer">
                      <span className="w-2 h-2 rounded-full mt-1 shrink-0 bg-[#FF5C73]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#EAF2FF] truncate">
                          <span className="font-bold text-[#4DA3FF]">{n.bead_name}</span>
                          {' / '}{n.sheet_name}
                        </p>
                        <p className="text-[10px] text-[#FF5C73]">{n.reason || 'NG'}</p>
                      </div>
                      <span className="text-[10px] text-[#556A88] shrink-0">{n.source === 'posts' ? '表二' : '表一'}</span>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User */}
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[#1A2438] transition-colors">
          <div className="w-6 h-6 rounded-full bg-[#4DA3FF] flex items-center justify-center">
            <User size={12} className="text-white" />
          </div>
          <span className="text-sm text-[#93A4C3]">QC 工程師</span>
          <ChevronDown size={12} className="text-[#93A4C3]" />
        </button>
      </div>
    </header>
  );
}
