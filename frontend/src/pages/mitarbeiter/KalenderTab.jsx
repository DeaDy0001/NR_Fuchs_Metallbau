import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPE_LABELS = {
  vacation: 'Urlaub',
  zeitausgleich: 'Zeitausgleich',
  sonderurlaub: 'Sonderurlaub',
  krankenstand: 'Krankenstand',
};

const MONTH_NAMES = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTH_SHORT = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const ROW_H = 26;   // px per day row
const DAY_COL_W = 36; // px for the day-number column
const HEADER_H = 44; // px for the month header row
const BAR_W = 14;   // px per employee bar
const BAR_GAP = 3;  // px gap between bars
const MIN_COL_W = 160; // minimum month column width

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function KalenderTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null); // { x, y, content }
  const scrollRef = useRef(null);

  useEffect(() => { load(); }, [year]);

  // Scroll to current month on load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      const today = new Date();
      if (today.getFullYear() === year) {
        const colW = calcColWidth(employees.length);
        const scrollX = Math.max(0, today.getMonth() * colW - 60);
        scrollRef.current.scrollLeft = scrollX;
      }
    }
  }, [loading, year, employees.length]);

  async function load() {
    setLoading(true);
    try {
      const [empRes, entryRes] = await Promise.all([
        fetch('/api/employees'),
        fetch(`/api/employees/entries?start=${year}-01-01&end=${year}-12-31`)
      ]);
      if (empRes.ok) {
        const d = await empRes.json();
        setEmployees(d.employees.filter(e => !e.archived));
      }
      if (entryRes.ok) {
        const d = await entryRes.json();
        setEntries(d.entries);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  function calcColWidth(empCount) {
    return Math.max(MIN_COL_W, empCount * (BAR_W + BAR_GAP) + 32);
  }

  const colW = calcColWidth(employees.length);
  const totalW = 12 * colW;
  const today = new Date();
  const todayMonth = today.getFullYear() === year ? today.getMonth() : -1;
  const todayDay = today.getDate();

  const handleMouseMove = useCallback((e, entry, emp) => {
    const startD = new Date(entry.start_date);
    const endD = new Date(entry.end_date);
    const diffDays = Math.round((endD - startD) / 86400000) + 1;
    setTooltip({
      x: e.clientX + 14,
      y: e.clientY - 10,
      content: {
        name: `${emp.first_name} ${emp.last_name}`,
        type: TYPE_LABELS[entry.type] || entry.type,
        start: entry.start_date,
        end: entry.end_date,
        days: diffDays,
        notes: entry.notes,
        color: emp.color || '#6366f1',
      }
    });
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Year selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
        <button className="ma-btn-icon" onClick={() => setYear(y => y - 1)}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)', minWidth: 50, textAlign: 'center' }}>{year}</span>
        <button className="ma-btn-icon" onClick={() => setYear(y => y + 1)}>
          <ChevronRight size={18} />
        </button>
      </div>

      {loading ? (
        <div className="ma-loading">Lade...</div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          {/* Sticky header: day-col corner + month headers */}
          <div style={{ display: 'flex', flexShrink: 0, borderBottom: '2px solid var(--border-color)', background: 'var(--bg-secondary)', zIndex: 10 }}>
            {/* Top-left corner (day column) */}
            <div style={{ width: DAY_COL_W, flexShrink: 0, borderRight: '1px solid var(--border-color)' }} />
            {/* Month header scroll shadow — synced to body scroll */}
            <div style={{ flex: 1, overflow: 'hidden' }} ref={el => {
              if (el && scrollRef.current) {
                scrollRef.current.addEventListener('scroll', () => { el.scrollLeft = scrollRef.current.scrollLeft; });
              }
            }}>
              <div style={{ width: totalW, display: 'flex' }}>
                {MONTH_NAMES.map((name, m) => (
                  <div key={m} style={{
                    width: colW, flexShrink: 0,
                    height: HEADER_H,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: '1px solid var(--border-color)',
                    fontWeight: 600, fontSize: '0.85rem',
                    color: m === todayMonth ? 'var(--primary-color, #6366f1)' : 'var(--text-primary)',
                    background: m === todayMonth ? 'rgba(99,102,241,0.06)' : 'transparent',
                  }}>
                    {MONTH_SHORT[m]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable body: day rows */}
          <div style={{ flex: 1, overflow: 'auto', display: 'flex' }} ref={scrollRef}>
            {/* Sticky day-number column */}
            <div style={{ width: DAY_COL_W, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)', position: 'sticky', left: 0, zIndex: 5 }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                <div key={day} style={{
                  height: ROW_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderBottom: '1px solid var(--border-color)',
                  fontSize: '0.75rem', fontWeight: 500,
                  color: 'var(--text-secondary)',
                }}>
                  {day}
                </div>
              ))}
            </div>

            {/* Month columns */}
            <div style={{ width: totalW, flexShrink: 0, display: 'flex' }}>
              {Array.from({ length: 12 }, (_, m) => {
                const daysInM = daysInMonth(year, m);
                const monthStart = new Date(year, m, 1);
                const monthEnd = new Date(year, m, daysInM);

                return (
                  <div key={m} style={{
                    width: colW, flexShrink: 0,
                    borderRight: '1px solid var(--border-color)',
                    position: 'relative',
                    background: m === todayMonth ? 'rgba(99,102,241,0.03)' : 'transparent',
                  }}>
                    {/* Day row backgrounds */}
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                      const isToday = m === todayMonth && day === todayDay;
                      const isOverflow = day > daysInM;
                      return (
                        <div key={day} style={{
                          height: ROW_H,
                          borderBottom: '1px solid var(--border-color)',
                          background: isToday
                            ? 'rgba(239,68,68,0.08)'
                            : isOverflow
                              ? 'rgba(0,0,0,0.02)'
                              : 'transparent',
                          opacity: isOverflow ? 0.4 : 1,
                        }} />
                      );
                    })}

                    {/* Employee bars */}
                    {employees.map((emp, empIdx) => {
                      const empEntries = entries.filter(e => e.employee_id === emp.id);
                      const barX = empIdx * (BAR_W + BAR_GAP) + 8;
                      const empColor = emp.color || '#6366f1';

                      return empEntries.map(entry => {
                        const entryStart = new Date(entry.start_date);
                        const entryEnd = new Date(entry.end_date);

                        // Clip to this month
                        if (entryEnd < monthStart || entryStart > monthEnd) return null;

                        const clippedStart = entryStart < monthStart ? monthStart : entryStart;
                        const clippedEnd = entryEnd > monthEnd ? monthEnd : entryEnd;

                        const startDay = clippedStart.getDate();
                        const endDay = clippedEnd.getDate();

                        const barTop = (startDay - 1) * ROW_H + 2;
                        const barHeight = (endDay - startDay + 1) * ROW_H - 4;

                        return (
                          <div
                            key={`${emp.id}-${entry.id}`}
                            onMouseMove={e => handleMouseMove(e, entry, emp)}
                            onMouseLeave={handleMouseLeave}
                            style={{
                              position: 'absolute',
                              left: barX,
                              top: barTop,
                              width: BAR_W,
                              height: barHeight,
                              background: empColor,
                              borderRadius: 4,
                              opacity: 0.85,
                              cursor: 'default',
                              zIndex: 2,
                            }}
                          />
                        );
                      });
                    })}

                    {/* Today line within month column */}
                    {m === todayMonth && (
                      <div style={{
                        position: 'absolute',
                        left: 0, right: 0,
                        top: (todayDay - 1) * ROW_H + ROW_H / 2,
                        height: 2,
                        background: 'rgba(239,68,68,0.5)',
                        pointerEvents: 'none',
                        zIndex: 3,
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x,
          top: tooltip.y,
          background: 'var(--bg-primary, #fff)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: '10px 14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          zIndex: 9999,
          pointerEvents: 'none',
          minWidth: 200,
          maxWidth: 280,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: tooltip.content.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              {tooltip.content.name}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <div><strong>Typ:</strong> {tooltip.content.type}</div>
            <div><strong>Von:</strong> {tooltip.content.start}</div>
            <div><strong>Bis:</strong> {tooltip.content.end}</div>
            <div><strong>Dauer:</strong> {tooltip.content.days} {tooltip.content.days === 1 ? 'Tag' : 'Tage'}</div>
            {tooltip.content.notes && <div style={{ marginTop: 4, color: 'var(--text-primary)' }}>{tooltip.content.notes}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
