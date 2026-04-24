import { Bell, User, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TopbarProps {
  title?: string;
}

export default function Topbar({ title = 'Automatic Baseline Assignment' }: TopbarProps) {
  const [showNotify, setShowNotify] = useState(false);

  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-[#2A3754] bg-[#0B1220] shrink-0">
      {/* Title */}
      <span className="text-sm font-medium text-[#93A4C3]">{title}</span>

      {/* Right actions */}
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
            <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF5C73] rounded-full" />
          </motion.button>
          <AnimatePresence>
            {showNotify && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                className="absolute right-0 top-10 w-72 bg-[#121A2B] border border-[#2A3754] rounded-xl shadow-xl z-50 p-3"
              >
                <p className="text-xs text-[#93A4C3] mb-2 px-1">最新通知</p>
                {[
                  { text: 'Lot 261412-02 線性超規，請確認', time: '9:42', type: 'ng' },
                  { text: '外觀檢驗 Batch B 髒汙 NG', time: '9:31', type: 'ng' },
                  { text: 'WO-2604-0012 已存檔', time: '9:18', type: 'ok' },
                ].map((n, i) => (
                  <div key={i} className="flex gap-2 px-1 py-2 hover:bg-[#1A2438] rounded-lg cursor-pointer">
                    <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${n.type === 'ng' ? 'bg-[#FF5C73]' : 'bg-[#00D4AA]'}`} />
                    <div>
                      <p className="text-xs text-[#EAF2FF]">{n.text}</p>
                      <p className="text-xs text-[#93A4C3]">{n.time}</p>
                    </div>
                  </div>
                ))}
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
