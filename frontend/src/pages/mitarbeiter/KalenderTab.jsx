import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPE_LABELS = {
  vacation: 'Urlaub',
  zeitausgleich: 'Zeitausgleich',
  sonderurlaub: 'Sonderurlaub',
  krankenstand: 'Krankenstand',
};
const TYPE_COLORS = {
  vacation: '#6366f1',
  zeitausgleich: '#22c55e',
  sonderurlaub: '#f59e0b',
  krankenstand: '#ef4444',
};

const MONTH_SHORT = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const ROW_H = 26;
const DAY_COL_W = 36;
const HEADER_H = 44;
const BAR_W = 14;
const BAR_GAP = 3;
const MIN_COL_W = 160;
// Fixed calendar height: header + 31 rows (each row + 1px border) + container borders
const CALENDAR_GRID_H = HEADER_H + 2 + 31 * (ROW_H + 1) + 2;

// ── Austrian holiday helpers ─────────────────────────────────────────────────
function getEasterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function getAustrianHolidays(year) {
  const easter = getEasterSunday(year);
  const add = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmt = d => d.toISOString().slice(0, 10);
  return new Set([
    `${year}-01-01`, `${year}-01-06`, `${year}-05-01`,
    `${year}-08-15`, `${year}-10-26`, `${year}-11-01`,
    `${year}-12-08`, `${year}-12-25`, `${year}-12-26`,
    fmt(add(easter, 1)), fmt(add(easter, 39)),
    fmt(add(easter, 50)), fmt(add(easter, 60)),
  ]);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function KalenderTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null);
  const scrollRef = useRef(null);
  const headerScrollRef = useRef(null);

  // Entries list state
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState('start_date');
  const [sortDir, setSortDir] = useState('desc');

  const holidays = useMemo(() => getAustrianHolidays(year), [year]);

  useEffect(() => { load(); }, [year]);

  // Scroll to current month after load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      const today = new Date();
      if (today.getFullYear() === year) {
        const colW = calcColWidth(employees.length);
        scrollRef.current.scrollLeft = Math.max(0, today.getMonth() * colW - 60);
      }
    }
  }, [loading, year, employees.length]);

  // Sync header with body scroll
  useEffect(() => {
    if (loading) return;
    const body = scrollRef.current;
    const header = headerScrollRef.current;
    if (!body || !header) return;
    const onScroll = () => { header.scrollLeft = body.scrollLeft; };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [loading]);

  async function load() {
    setLoading(true);
    try {
      const [empRes, entryRes] = await Promise.all([
        fetch('/api/employees'),
        fetch(`/api/employees/entries?start=${year}-01-01&end=${year}-12-31`)
      ]);
      if (empRes.ok) setEmployees((await empRes.json()).employees.filter(e => !e.archived));
      if (entryRes.ok) setEntries((await entryRes.json()).entries);
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

  function getDayBg(m, day, daysInM) {
    if (day > daysInM) return { bg: 'rgba(0,0,0,0.02)', opacity: 0.4 };
    const isToday = m === todayMonth && day === todayDay;
    const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(year, m, day).getDay();
    const isHol = holidays.has(dateStr);
    const isSun = dow === 0;
    const isSat = dow === 6;
    const bg = isHol
      ? 'rgba(251,191,36,0.18)'
      : isSun
        ? 'rgba(34,197,94,0.14)'
        : isSat
          ? 'rgba(34,197,94,0.07)'
          : isToday
            ? 'rgba(239,68,68,0.1)'
            : 'transparent';
    return { bg, opacity: 1 };
  }

  // ── Entries list ────────────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    let result = entries.filter(e => {
      const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
      const matchSearch = !search || name.includes(search.toLowerCase());
      const matchType = !typeFilter || e.type === typeFilter;
      return matchSearch && matchType;
    });

    result = [...result].sort((a, b) => {
      let va, vb;
      if (sortKey === 'name') {
        va = `${a.first_name} ${a.last_name}`.toLowerCase();
        vb = `${b.first_name} ${b.last_name}`.toLowerCase();
      } else if (sortKey === 'days') {
        va = Math.round((new Date(a.end_date) - new Date(a.start_date)) / 86400000);
        vb = Math.round((new Date(b.end_date) - new Date(b.start_date)) / 86400000);
      } else {
        va = a[sortKey] || '';
        vb = b[sortKey] || '';
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [entries, search, typeFilter, sortKey, sortDir]);

  function handleSort(field) {
    if (sortKey === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(field); setSortDir('asc'); }
  }

  function SortTh({ field, children }) {
    const active = sortKey === field;
    return (
      <th
        onClick={() => handleSort(field)}
        style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.8rem', color: active ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {children}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Year selector + legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="ma-btn-icon" onClick={() => setYear(y => y - 1)}><ChevronLeft size={18} /></button>
          <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)', minWidth: 50, textAlign: 'center' }}>{year}</span>
          <button className="ma-btn-icon" onClick={() => setYear(y => y + 1)}><ChevronRight size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(251,191,36,0.5)', display: 'inline-block', border: '1px solid rgba(251,191,36,0.6)' }} />
            Feiertag
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(34,197,94,0.25)', display: 'inline-block' }} />
            Wochenende
          </span>
        </div>
      </div>

      {loading ? (
        <div className="ma-loading">Lade...</div>
      ) : (
        <>
          {/* Calendar grid — fixed height so entries list renders below */}
          <div style={{ height: CALENDAR_GRID_H, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 8 }}>
            {/* Sticky month header */}
            <div style={{ display: 'flex', flexShrink: 0, borderBottom: '2px solid var(--border-color)', background: 'var(--bg-secondary)', zIndex: 10 }}>
              <div style={{ width: DAY_COL_W, flexShrink: 0, borderRight: '1px solid var(--border-color)' }} />
              <div style={{ flex: 1, overflow: 'hidden' }} ref={headerScrollRef}>
                <div style={{ width: totalW, display: 'flex' }}>
                  {MONTH_SHORT.map((name, m) => (
                    <div key={m} style={{
                      width: colW, flexShrink: 0, height: HEADER_H,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRight: '1px solid var(--border-color)',
                      fontWeight: 600, fontSize: '0.85rem',
                      color: m === todayMonth ? 'var(--primary-color, #6366f1)' : 'var(--text-primary)',
                      background: m === todayMonth ? 'rgba(99,102,241,0.06)' : 'transparent',
                    }}>
                      {name}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex' }} ref={scrollRef}>
              {/* Sticky day-number column */}
              <div style={{ width: DAY_COL_W, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)', position: 'sticky', left: 0, zIndex: 5 }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <div key={day} style={{
                    height: ROW_H,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.72rem', fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}>
                    {day}
                  </div>
                ))}
              </div>

              {/* Month columns — background-image for full-height vertical dividers */}
              <div style={{
                width: totalW, flexShrink: 0, display: 'flex', alignSelf: 'stretch',
                backgroundImage: `repeating-linear-gradient(to right, transparent ${colW - 1}px, var(--border-color) ${colW - 1}px, var(--border-color) ${colW}px)`,
                backgroundSize: `${colW}px 100%`,
              }}>
                {Array.from({ length: 12 }, (_, m) => {
                  const daysInM = daysInMonth(year, m);
                  const monthStart = new Date(year, m, 1);
                  const monthEnd = new Date(year, m, daysInM);

                  return (
                    <div key={m} style={{ width: colW, flexShrink: 0, position: 'relative' }}>
                      {/* Day row backgrounds */}
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                        const { bg, opacity } = getDayBg(m, day, daysInM);
                        return (
                          <div key={day} style={{
                            height: ROW_H,
                            borderBottom: '1px solid var(--border-color)',
                            background: bg, opacity,
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
                          if (entryEnd < monthStart || entryStart > monthEnd) return null;

                          const clippedStart = entryStart < monthStart ? monthStart : entryStart;
                          const clippedEnd = entryEnd > monthEnd ? monthEnd : entryEnd;
                          const startDay = clippedStart.getDate();
                          const endDay = clippedEnd.getDate();

                          return (
                            <div
                              key={`${emp.id}-${entry.id}`}
                              onMouseMove={e => handleMouseMove(e, entry, emp)}
                              onMouseLeave={handleMouseLeave}
                              style={{
                                position: 'absolute',
                                left: barX, top: (startDay - 1) * ROW_H + 2,
                                width: BAR_W, height: (endDay - startDay + 1) * ROW_H - 4,
                                background: empColor, borderRadius: 4,
                                opacity: 0.85, cursor: 'default', zIndex: 2,
                              }}
                            />
                          );
                        });
                      })}

                      {/* Today line */}
                      {m === todayMonth && (
                        <div style={{
                          position: 'absolute', left: 0, right: 0,
                          top: (todayDay - 1) * ROW_H + ROW_H / 2,
                          height: 2, background: 'rgba(239,68,68,0.6)',
                          pointerEvents: 'none', zIndex: 3,
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Entries list ─────────────────────────────────────────────── */}
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                Einträge {year}
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {filteredEntries.length}{filteredEntries.length !== entries.length ? ` von ${entries.length}` : ''} Einträge
              </span>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                className="ma-input"
                style={{ maxWidth: 220 }}
                placeholder="Name suchen…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select
                className="ma-select"
                style={{ maxWidth: 180 }}
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="">Alle Typen</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="ma-empty">Keine Einträge gefunden.</div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                      <SortTh field="name">Name</SortTh>
                      <SortTh field="type">Typ</SortTh>
                      <SortTh field="start_date">Von</SortTh>
                      <SortTh field="end_date">Bis</SortTh>
                      <SortTh field="days">Dauer</SortTh>
                      <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Notizen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map(entry => {
                      const emp = employees.find(e => e.id === entry.employee_id);
                      const days = Math.round((new Date(entry.end_date) - new Date(entry.start_date)) / 86400000) + 1;
                      return (
                        <tr
                          key={entry.id}
                          style={{ borderBottom: '1px solid var(--border-color)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: emp?.color || '#6366f1', flexShrink: 0 }} />
                              {entry.first_name} {entry.last_name}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                              fontSize: '0.75rem', fontWeight: 500,
                              background: (TYPE_COLORS[entry.type] || '#888') + '22',
                              color: TYPE_COLORS[entry.type] || '#888',
                            }}>
                              {TYPE_LABELS[entry.type] || entry.type}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{entry.start_date}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{entry.end_date}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{days} T.</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {entry.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x, top: tooltip.y,
          background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color)',
          borderRadius: 8, padding: '10px 14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 9999,
          pointerEvents: 'none', minWidth: 200, maxWidth: 280,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: tooltip.content.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{tooltip.content.name}</span>
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
