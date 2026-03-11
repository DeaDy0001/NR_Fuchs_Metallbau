import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Trash2, Check, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPES = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
const TYPE_LABELS = { vacation: 'Urlaub', zeitausgleich: 'Zeitausgleich', sonderurlaub: 'Sonderurlaub', krankenstand: 'Krankenstand' };
const TYPE_COLORS = { vacation: '#6366f1', zeitausgleich: '#22c55e', sonderurlaub: '#f59e0b', krankenstand: '#ef4444' };

const MONTH_NAMES = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const EMPTY_ENTRY = { type: 'vacation', start_date: '', end_date: '', amount: '', notes: '' };
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ── Holiday helpers ──────────────────────────────────────────────────────────
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

// ── Work day calculation ─────────────────────────────────────────────────────
function calcWorkAmount(startDate, endDate, workSchedule, unit) {
  if (!startDate || !endDate || !workSchedule) return null;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (start > end) return null;

  const y1 = start.getFullYear(), y2 = end.getFullYear();
  const hols = new Set([...getAustrianHolidays(y1), ...(y2 !== y1 ? [...getAustrianHolidays(y2)] : [])]);

  let workDays = 0, workHours = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    if (hols.has(dateStr)) continue;
    const key = DAY_KEYS[d.getDay()];
    const h = workSchedule[key] || 0;
    if (h > 0) { workDays++; workHours += h; }
  }

  if (unit === 'hours') return workHours;
  if (unit === 'halfdays') return workDays * 2;
  return workDays;
}

// ── WorkdayDatePicker ────────────────────────────────────────────────────────
function WorkdayDatePicker({ value, onChange, minDate, workSchedule }) {
  const parseDate = s => s ? new Date(s + 'T00:00:00') : null;
  const initDate = parseDate(value) || (minDate ? parseDate(minDate) : null) || new Date();

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const popupRef = useRef(null);

  const holidays = useMemo(() => getAustrianHolidays(viewYear), [viewYear]);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync view to minDate when it changes and current view is before minDate
  useEffect(() => {
    if (!minDate) return;
    const minD = parseDate(minDate);
    if (viewYear < minD.getFullYear() || (viewYear === minD.getFullYear() && viewMonth < minD.getMonth())) {
      setViewYear(minD.getFullYear());
      setViewMonth(minD.getMonth());
    }
  }, [minDate]);

  const daysInM = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInM; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function toDateStr(day) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function isDayDisabled(day) {
    if (!day) return true;
    const dateStr = toDateStr(day);
    if (minDate && dateStr < minDate) return true;
    if (workSchedule) {
      const key = DAY_KEYS[new Date(viewYear, viewMonth, day).getDay()];
      if ((workSchedule[key] || 0) === 0) return true;
    }
    return false;
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div style={{ position: 'relative' }} ref={popupRef}>
      <div
        className="ma-input"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ flex: 1, color: value ? 'inherit' : 'var(--text-muted, #9ca3af)', fontSize: '0.875rem' }}>
          {displayValue || 'Datum wählen…'}
        </span>
        <Calendar size={14} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: 10, padding: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 256,
        }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" className="ma-btn-icon" style={{ width: 26, height: 26 }} onClick={prevMonth}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button type="button" className="ma-btn-icon" style={{ width: 26, height: 26 }} onClick={nextMonth}>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d, i) => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.68rem', fontWeight: 700, padding: '2px 0',
                color: i >= 5 ? 'rgba(34,197,94,0.9)' : 'var(--text-secondary)',
              }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = toDateStr(day);
              const disabled = isDayDisabled(day);
              const isHol = holidays.has(dateStr);
              const dow = new Date(viewYear, viewMonth, day).getDay();
              const isWknd = dow === 0 || dow === 6;
              const selected = dateStr === value;
              const isToday = dateStr === todayStr;

              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => { if (!disabled) { onChange(dateStr); setOpen(false); } }}
                  style={{
                    height: 30, border: 'none', borderRadius: 6, fontSize: '0.78rem',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    background: selected
                      ? '#6366f1'
                      : isToday
                        ? 'rgba(99,102,241,0.12)'
                        : isHol
                          ? 'rgba(251,191,36,0.2)'
                          : isWknd
                            ? 'rgba(34,197,94,0.08)'
                            : 'transparent',
                    color: selected
                      ? '#fff'
                      : disabled
                        ? 'var(--text-muted, #9ca3af)'
                        : isHol
                          ? '#92400e'
                          : isWknd
                            ? '#16a34a'
                            : 'var(--text-primary)',
                    fontWeight: selected || isToday ? 700 : 400,
                    opacity: disabled ? 0.3 : 1,
                    outline: isToday && !selected ? '1px solid rgba(99,102,241,0.5)' : 'none',
                  }}
                >{day}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function unitLabel(unit) {
  if (unit === 'hours') return 'Stunden';
  if (unit === 'halfdays') return 'Halbtage';
  return 'Tage';
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt + 'T00:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Mini Calendar ─────────────────────────────────────────────────────────────
function MiniCalendar({ rangeStart, rangeEnd, allEntries, employees }) {
  if (!rangeStart || !rangeEnd) return null;

  const displayStart = addDays(rangeStart, -4);
  const displayEnd = addDays(rangeEnd, 4);
  const totalDays = daysBetween(displayStart, displayEnd);
  const DAY_W = 36, ROW_H = 30, LEFT_W = 130;

  const relevantEmpIds = [...new Set(allEntries.map(e => e.employee_id))];
  const relevantEmps = employees.filter(e => relevantEmpIds.includes(e.id) || !relevantEmpIds.length);

  const days = [];
  for (let i = 0; i < totalDays; i++) days.push(addDays(displayStart, i));

  const isInRange = d => d >= rangeStart && d <= rangeEnd;
  const isWeekend = d => { const day = new Date(d + 'T00:00:00').getDay(); return day === 0 || day === 6; };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', minWidth: LEFT_W + totalDays * DAY_W }}>
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
          <div style={{ height: 30, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }} />
          {relevantEmps.map(emp => (
            <div key={emp.id} style={{
              height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 10px',
              borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem', fontWeight: 500,
              color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {emp.first_name} {emp.last_name}
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', height: 30, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
            {days.map(d => (
              <div key={d} style={{
                width: DAY_W, flexShrink: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem',
                color: isInRange(d) ? 'var(--accent-primary)' : (isWeekend(d) ? '#16a34a' : 'var(--text-secondary)'),
                fontWeight: isInRange(d) ? 700 : 400,
                borderRight: '1px solid var(--border-color)',
                background: isInRange(d) ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <span>{new Date(d + 'T00:00:00').getDate()}</span>
                <span style={{ fontSize: '0.6rem' }}>{['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(d + 'T00:00:00').getDay()]}</span>
              </div>
            ))}
          </div>

          {relevantEmps.map((emp, empIdx) => {
            const empEntries = allEntries.filter(e => e.employee_id === emp.id);
            return (
              <div key={emp.id} style={{
                display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border-color)',
                position: 'relative',
                background: empIdx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
              }}>
                {days.map(d => (
                  <div key={d} style={{
                    width: DAY_W, flexShrink: 0, borderRight: '1px solid rgba(42,45,62,0.5)',
                    background: isInRange(d) ? 'rgba(99,102,241,0.05)' : (isWeekend(d) ? 'rgba(34,197,94,0.05)' : 'transparent'),
                  }} />
                ))}
                {empEntries.map(entry => {
                  if (entry.start_date > displayEnd || entry.end_date < displayStart) return null;
                  const clampedStart = entry.start_date < displayStart ? displayStart : entry.start_date;
                  const clampedEnd = entry.end_date > displayEnd ? displayEnd : entry.end_date;
                  const startIdx = days.indexOf(clampedStart);
                  const endIdx = days.indexOf(clampedEnd);
                  if (startIdx < 0 || endIdx < 0) return null;
                  const barW = (endIdx - startIdx + 1) * DAY_W - 2;
                  return (
                    <div key={entry.id} title={`${emp.first_name} ${emp.last_name}: ${TYPE_LABELS[entry.type]} ${entry.start_date} – ${entry.end_date}`} style={{
                      position: 'absolute', left: startIdx * DAY_W + 1, top: 4,
                      height: ROW_H - 8, width: barW,
                      background: TYPE_COLORS[entry.type] || '#888', borderRadius: 4,
                      display: 'flex', alignItems: 'center', paddingLeft: 5,
                      fontSize: '0.65rem', color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap',
                      opacity: 0.85, zIndex: 2,
                    }}>
                      {barW > 60 && `${emp.first_name} (${TYPE_LABELS[entry.type]})`}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ZeitEintragenTab() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [empBalances, setEmpBalances] = useState(null);
  const [config, setConfig] = useState({});
  const [entries, setEntries] = useState([{ ...EMPTY_ENTRY }]);
  const [allEntries, setAllEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const calendarStart = entries.reduce((acc, e) => e.start_date && (!acc || e.start_date < acc) ? e.start_date : acc, null);
  const calendarEnd = entries.reduce((acc, e) => e.end_date && (!acc || e.end_date > acc) ? e.end_date : acc, null);

  const selEmpObj = employees.find(e => e.id === parseInt(selectedEmp));

  const load = useCallback(async () => {
    const [empRes, cfgRes] = await Promise.all([
      fetch('/api/employees'),
      fetch('/api/employees/config'),
    ]);
    if (empRes.ok) setEmployees((await empRes.json()).employees.filter(e => !e.archived));
    if (cfgRes.ok) setConfig(await cfgRes.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedEmp) { setEmpBalances(null); return; }
    const year = new Date().getFullYear();
    fetch(`/api/employees/${selectedEmp}/balances?year=${year}`)
      .then(r => r.json()).then(d => setEmpBalances(d.balances)).catch(() => {});
  }, [selectedEmp]);

  // Re-calculate amounts when employee changes
  useEffect(() => {
    if (!selectedEmp) return;
    const emp = employees.find(e => e.id === parseInt(selectedEmp));
    if (!emp?.work_schedule) return;
    setEntries(prev => prev.map(e => {
      if (!e.start_date || !e.end_date) return e;
      const unit = config[`unit_${e.type}`] || 'days';
      const amount = calcWorkAmount(e.start_date, e.end_date, emp.work_schedule, unit);
      return amount !== null ? { ...e, amount: String(amount) } : e;
    }));
  }, [selectedEmp]); // intentionally minimal deps

  useEffect(() => {
    if (!calendarStart || !calendarEnd) return;
    const start = addDays(calendarStart, -4);
    const end = addDays(calendarEnd, 4);
    fetch(`/api/employees/entries?start=${start}&end=${end}`)
      .then(r => r.json()).then(d => setAllEntries(d.entries || [])).catch(() => {});
  }, [calendarStart, calendarEnd]);

  const addEntry = () => setEntries(p => [...p, { ...EMPTY_ENTRY }]);
  const removeEntry = idx => setEntries(p => p.filter((_, i) => i !== idx));

  const updateEntry = (idx, key, val) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const updated = { ...e, [key]: val };
      // Auto-recalculate amount when dates or type change
      if (['start_date', 'end_date', 'type'].includes(key) && selEmpObj?.work_schedule) {
        const unit = config[`unit_${updated.type}`] || 'days';
        const amount = calcWorkAmount(updated.start_date, updated.end_date, selEmpObj.work_schedule, unit);
        if (amount !== null) updated.amount = String(amount);
      }
      // If start_date changes and end_date is now before start_date, clear end_date
      if (key === 'start_date' && updated.end_date && val > updated.end_date) {
        updated.end_date = '';
        updated.amount = '';
      }
      return updated;
    }));
  };

  const handleSubmit = async () => {
    setError(''); setMsg('');
    if (!selectedEmp) return setError('Bitte Mitarbeiter auswählen.');
    for (const e of entries) {
      if (!e.type || !e.start_date || !e.end_date || !e.amount) {
        return setError('Alle Felder (Typ, Datum Von/Bis, Menge) müssen ausgefüllt sein.');
      }
      if (e.end_date < e.start_date) return setError('Enddatum muss nach Startdatum liegen.');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/employees/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entries.map(e => ({ ...e, employee_id: parseInt(selectedEmp), amount: parseFloat(e.amount) }))
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      setMsg(`${entries.length} Eintrag/Einträge erfolgreich gespeichert.`);
      setEntries([{ ...EMPTY_ENTRY }]);
      const year = new Date().getFullYear();
      const bRes = await fetch(`/api/employees/${selectedEmp}/balances?year=${year}`);
      if (bRes.ok) setEmpBalances((await bRes.json()).balances);
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  return (
    <div>
      {error && <div className="ma-error">{error}</div>}
      {msg && <div className="ma-success">{msg}</div>}

      {/* Mitarbeiter wählen */}
      <div className="ma-card" style={{ marginBottom: 16 }}>
        <div className="ma-field" style={{ marginBottom: 0 }}>
          <label className="ma-label">Mitarbeiter *</label>
          <select className="ma-select" value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}>
            <option value="">— Mitarbeiter wählen —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
            ))}
          </select>
        </div>

        {empBalances && (
          <div className="ma-balance-grid" style={{ marginTop: 14 }}>
            {TYPES.map(t => {
              const b = empBalances[t] || { allocated: 0, used: 0, remaining: 0 };
              const unit = unitLabel(config[`unit_${t}`] || 'days');
              return (
                <div key={t} className="ma-balance-chip" style={{ borderLeft: `3px solid ${TYPE_COLORS[t]}` }}>
                  <div className="ma-balance-chip-label">{TYPE_LABELS[t]}</div>
                  <div className="ma-balance-chip-values">
                    <span className="ma-balance-chip-remaining">{b.remaining} {unit}</span>
                    <span className="ma-balance-chip-used">verfügbar ({b.used} verbraucht)</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Einträge — only when employee selected */}
      {selectedEmp && <div className="ma-card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>Einträge</div>
        {entries.map((entry, idx) => {
          const unit = config[`unit_${entry.type}`] || 'days';
          const computedAmount = selEmpObj?.work_schedule
            ? calcWorkAmount(entry.start_date, entry.end_date, selEmpObj.work_schedule, unit)
            : null;

          return (
            <div key={idx} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 12, marginBottom: 10, border: '1px solid var(--border-color)', position: 'relative' }}>
              {entries.length > 1 && (
                <button className="ma-btn-icon danger" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => removeEntry(idx)} title="Entfernen">
                  <Trash2 size={14} />
                </button>
              )}

              {/* Row 1: Typ + Von + Bis */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '0 12px', marginBottom: 8 }}>
                <div className="ma-field" style={{ marginBottom: 0 }}>
                  <label className="ma-label">Typ</label>
                  <select className="ma-select" value={entry.type} onChange={e => updateEntry(idx, 'type', e.target.value)}>
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div className="ma-field" style={{ marginBottom: 0 }}>
                  <label className="ma-label">Von *</label>
                  <WorkdayDatePicker
                    value={entry.start_date}
                    onChange={val => updateEntry(idx, 'start_date', val)}
                    workSchedule={selEmpObj?.work_schedule}
                  />
                </div>
                <div className="ma-field" style={{ marginBottom: 0 }}>
                  <label className="ma-label">Bis *</label>
                  <WorkdayDatePicker
                    value={entry.end_date}
                    onChange={val => updateEntry(idx, 'end_date', val)}
                    minDate={entry.start_date || undefined}
                    workSchedule={selEmpObj?.work_schedule}
                  />
                </div>
              </div>

              {/* Row 2: Amount (auto) + Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 2fr', gap: '0 12px' }}>
                <div className="ma-field" style={{ marginBottom: 0 }}>
                  <label className="ma-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {unitLabel(unit)} *
                    {computedAmount !== null && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 400 }}>(auto)</span>
                    )}
                  </label>
                  <input
                    className="ma-input"
                    type="number"
                    min="0"
                    step="0.5"
                    value={entry.amount}
                    onChange={e => updateEntry(idx, 'amount', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="ma-field" style={{ marginBottom: 0 }}>
                  <label className="ma-label">Notizen</label>
                  <input className="ma-input" value={entry.notes} onChange={e => updateEntry(idx, 'notes', e.target.value)} placeholder="Optional…" />
                </div>
              </div>
            </div>
          );
        })}

        <button className="ma-btn ma-btn-secondary" onClick={addEntry} style={{ marginTop: 4 }}>
          <Plus size={15} />
          Weiteren Eintrag hinzufügen
        </button>
      </div>}

      {/* Mini-Calendar */}
      {calendarStart && calendarEnd && (
        <div className="ma-card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>
            Zeitraum Übersicht
            <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
              {fmt(addDays(calendarStart, -4))} – {fmt(addDays(calendarEnd, 4))}
            </span>
          </div>
          <MiniCalendar rangeStart={calendarStart} rangeEnd={calendarEnd} allEntries={allEntries} employees={employees} />
          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[k], display: 'inline-block' }} />
                {v}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      {selectedEmp && (
        <button
          className="ma-btn ma-btn-primary"
          onClick={handleSubmit}
          disabled={saving}
          style={{ padding: '10px 24px', fontSize: '0.9rem' }}
        >
          <Check size={16} />
          {saving ? 'Eintragen...' : 'Eintragen'}
        </button>
      )}
    </div>
  );
}
