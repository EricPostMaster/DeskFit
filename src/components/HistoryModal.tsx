import React, { useState } from 'react';

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  weeks: { date: string; percent: number; day: number }[][];
  dailyGoal: Record<string, number>;
  tasksHistory: Record<string, number>;
  getHeatmapColor: (percent: number) => string;
}

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const HistoryModal: React.FC<HistoryModalProps> = ({ open, onClose, weeks, dailyGoal, tasksHistory, getHeatmapColor }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);
  const [, setForceUpdate] = useState(0);
  if (!open) return null;
  const today = new Date().toISOString().slice(0, 10);
  const handleResetToday = () => {
    tasksHistory[today] = 0;
    if (window && window.localStorage) {
      const key = 'deskfit-tasks-history';
      window.localStorage.setItem(key, JSON.stringify(tasksHistory));
    }
    setForceUpdate(x => x + 1);
  };
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div style={{ background: '#fff', padding: 24, borderRadius: 12, minWidth: 420, maxWidth: 600, boxShadow: '0 2px 16px #0002', maxHeight: 520, overflowY: 'auto', position: 'relative' }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Last 30 Days</h2>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 2, marginBottom: 8 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Array.from({ length: 7 }).map((_, di) => {
                const day = week.find(d => d.day === di);
                let tooltipContent = '';
                if (day) {
                  const weekDayStr = WEEKDAYS[day.day];
                  const goal = dailyGoal[weekDayStr] || 1;
                  const completed = tasksHistory[day.date] || 0;
                  tooltipContent = `${day.date}\n${day.percent}% complete\n${completed} tasks`;
                }
                return (
                  <div
                    key={di}
                    style={{
                      width: 16, height: 16, borderRadius: 3,
                      background: day ? getHeatmapColor(day.percent) : '#f5f5f5',
                      border: '1px solid #e0e0e0',
                      boxSizing: 'border-box',
                      marginBottom: di === 6 ? 0 : 0,
                      position: 'relative',
                      cursor: day ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => {
                      if (day) {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          content: `${day.date}\n${day.percent}% complete\n${tasksHistory[day.date] || 0} tasks`
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'fixed',
              left: tooltip.x + 8,
              top: tooltip.y - 36,
              background: '#222',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
              whiteSpace: 'pre-line',
              pointerEvents: 'none',
              zIndex: 2000,
              boxShadow: '0 2px 8px #0003',
            }}
          >
            {tooltip.content}
          </div>
        )}
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: '#666' }}>
          <span>Less</span>
          {[0,1,2,3,4,5].map(i => (
            <span key={i} style={{ width: 16, height: 12, background: getHeatmapColor(i*20), display: 'inline-block', borderRadius: 2, border: '1px solid #e0e0e0' }} />
          ))}
          <span>More</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          <button onClick={handleResetToday} style={{ fontWeight: 'bold', color: '#c62828', background: '#fbe9e7', border: '1px solid #ffcdd2', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>
            Reset Today's Task Count
          </button>
          <button onClick={onClose} style={{ fontWeight: 'bold' }}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
