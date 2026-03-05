import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPE_COLORS = {
  vacation: '#6366f1',
  zeitausgleich: '#22c55e',
  sonderurlaub: '#f59e0b',
  krankenstand: '#ef4444',
};

const TYPE_LABELS = {
  vacation: 'Urlaub',
  zeitausgleich: 'Zeitausgleich',
  sonderurlaub: 'Sonderurlaub',
  krankenstand: 'Krankenstand',
};

const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DAY_W = 28;  // px per day
const ROW_H = 36;  // px per employee row
const LEFT_W = 160; // px for employee name column

function daysInYear(year) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

function dayOfYear(dateStr, year) {
  const d = new Date(dateStr);
  const start = new Date(year, 0, 1);
  return Math.floor((d - start) / 86400000);
}

function monthOffsets(year) {
  const offsets = [];
  let offset = 0;
  for (let m = 0; m < 12; m++) {
    offsets.push({ month: m, offset, days: new Date(year, m + 1, 0).getDate() });
    offset += new Date(year, m + 1, 0).getDate();
  }
  return offsets;
}

export default function KalenderTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    load();
  }, [year]);

  // Scroll to today on first load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      const today = new Date();
      if (today.getFullYear() === year) {
        const doy = dayOfYear(today.toISOString().slice(0, 10), year);
        const scrollX = Math.max(0, doy * DAY_W - 200);
        scrollRef.current.scrollLeft = scrollX;
      }
    }
  }, [loading, year]);

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

  const totalDays = daysInYear(year);
  const months = monthOffsets(year);
  const timelineW = totalDays * DAY_W;

  // Today marker
  const today = new Date();
  const todayDoy = today.getFullYear() === year
    ? dayOfYear(today.toISOString().slice(0, 10), year)
    : -1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Year selector + legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="ma-btn-icon" onClick={() => setYear(y => y - 1)}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)', minWidth: 50, textAlign: 'center' }}>{year}</span>
          <button className="ma-btn-icon" onClick={() => setYear(y => y + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: TYPE_COLORS[k], display: 'inline-block' }} />
              {v}
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="ma-loading">Lade...</div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Fixed header row: employee col + scrollable months */}
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {/* Top-left corner */}
            <div style={{ width: LEFT_W, flexShrink: 0, borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }} />
            {/* Month headers (synced scroll) */}
            <div style={{ flex: 1, overflow: 'hidden' }} ref={el => {
              // Keep month header in sync with main scroll
              if (el && scrollRef.current) {
                scrollRef.current.addEventListener('scroll', () => { el.scrollLeft = scrollRef.current.scrollLeft; });
              }
            }}>
              <div style={{ width: timelineW, display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                {months.map(({ month, offset, days }) => (
                  <div key={month} style={{
                    width: days * DAY_W,
                    borderRight: '1px solid var(--border-color)',
                    padding: '6px 8px',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    flexShrink: 0,
                  }}>
                    {MONTHS[month]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflow: 'auto', display: 'flex' }} ref={scrollRef}>
            {/* Employee name column (sticky left) */}
            <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
              {employees.length === 0 ? (
                <div style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Keine Mitarbeiter</div>
              ) : employees.map(emp => (
                <div key={emp.id} style={{
                  height: ROW_H,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  borderBottom: '1px solid var(--border-color)',
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  background: 'var(--bg-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {emp.first_name} {emp.last_name}
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div style={{ position: 'relative', width: timelineW, flexShrink: 0 }}>
              {/* Today line */}
              {todayDoy >= 0 && (
                <div style={{
                  position: 'absolute',
                  left: todayDoy * DAY_W + DAY_W / 2,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: 'rgba(239,68,68,0.6)',
                  zIndex: 5,
                  pointerEvents: 'none',
                }} />
              )}

              {/* Month grid lines */}
              {months.map(({ month, offset }) => (
                <div key={month} style={{
                  position: 'absolute',
                  left: offset * DAY_W,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'var(--border-color)',
                  opacity: 0.5,
                  pointerEvents: 'none',
                }} />
              ))}

              {/* Employee rows with entries */}
              {employees.map((emp, idx) => {
                const empEntries = entries.filter(e => e.employee_id === emp.id);
                return (
                  <div key={emp.id} style={{
                    position: 'relative',
                    height: ROW_H,
                    borderBottom: '1px solid var(--border-color)',
                    background: idx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                  }}>
                    {empEntries.map(entry => {
                      const startD = new Date(Math.max(new Date(entry.start_date), new Date(year, 0, 1)));
                      const endD = new Date(Math.min(new Date(entry.end_date), new Date(year, 11, 31)));
                      const startDoy = dayOfYear(startD.toISOString().slice(0, 10), year);
                      const endDoy = dayOfYear(endD.toISOString().slice(0, 10), year);
                      const barW = Math.max((endDoy - startDoy + 1) * DAY_W, DAY_W);

                      return (
                        <div
                          key={entry.id}
                          title={`${TYPE_LABELS[entry.type] || entry.type}: ${entry.start_date} – ${entry.end_date}`}
                          style={{
                            position: 'absolute',
                            left: startDoy * DAY_W,
                            top: 5,
                            height: ROW_H - 10,
                            width: barW,
                            background: TYPE_COLORS[entry.type] || '#888',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: 6,
                            fontSize: '0.7rem',
                            color: '#fff',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            opacity: 0.88,
                            cursor: 'default',
                          }}
                        >
                          {barW > 50 && `${emp.first_name} ${emp.last_name}`}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
