import { useState, useRef, useCallback } from 'react';
import { CheckSquare, Square, ListChecks } from 'lucide-react';
import './CheckboxNotes.css';

/**
 * CheckboxNotes – a textarea-like component that renders [ ] / [x] lines as
 * interactive checkboxes.  Plain text lines render normally.
 *
 * Storage format (plain text, markdown-like):
 *   [ ] unchecked item
 *   [x] checked item
 *   Normal text line
 *
 * Props:
 *   value      – string  (the notes text)
 *   onChange   – fn(newValue)  called whenever content changes
 *   placeholder – string
 *   disabled   – boolean
 */
function CheckboxNotes({ value = '', onChange, placeholder = 'Notizen eingeben...', disabled = false }) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef(null);

  const lines = (value || '').split('\n');
  const hasCheckboxes = lines.some(l => /^\[[ x]\] /.test(l));

  // Toggle a checkbox line between [ ] and [x]
  const toggleLine = useCallback((lineIndex) => {
    if (disabled) return;
    const updated = lines.map((line, i) => {
      if (i !== lineIndex) return line;
      if (line.startsWith('[ ] ')) return '[x] ' + line.substring(4);
      if (line.startsWith('[x] ')) return '[ ] ' + line.substring(4);
      return line;
    });
    onChange(updated.join('\n'));
  }, [lines, onChange, disabled]);

  // Insert a new checkbox line at the end
  const addCheckbox = useCallback(() => {
    if (disabled) return;
    const newVal = value ? value + '\n[ ] ' : '[ ] ';
    onChange(newVal);
    // Switch to editing and focus at end
    setEditing(true);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = newVal.length;
        textareaRef.current.selectionEnd = newVal.length;
      }
    }, 50);
  }, [value, onChange, disabled]);

  // Handle Enter in textarea: if current line is a checkbox, insert new checkbox
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Enter') return;
    const ta = e.target;
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const after = ta.value.substring(pos);

    // Find the current line
    const lastNewline = before.lastIndexOf('\n');
    const currentLine = before.substring(lastNewline + 1);

    if (/^\[[ x]\] /.test(currentLine)) {
      // If current line is empty checkbox, remove it instead of adding another
      if (currentLine === '[ ] ' || currentLine === '[x] ') {
        e.preventDefault();
        const newVal = before.substring(0, lastNewline === -1 ? 0 : lastNewline) + (after ? '\n' + after : after);
        onChange(newVal);
        setTimeout(() => {
          ta.selectionStart = ta.selectionEnd = (lastNewline === -1 ? 0 : lastNewline + 1);
        }, 0);
        return;
      }
      e.preventDefault();
      const newVal = before + '\n[ ] ' + after;
      onChange(newVal);
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = pos + 5; // after \n[ ]
      }, 0);
    }
  }, [onChange]);

  if (editing) {
    return (
      <div className="checkbox-notes-wrap">
        <textarea
          ref={textareaRef}
          className="checkbox-notes-textarea"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus
        />
        <button type="button" className="checkbox-notes-add-btn" onMouseDown={e => { e.preventDefault(); addCheckbox(); }} title="Checkbox hinzufügen">
          <ListChecks size={14} /> Checkbox
        </button>
      </div>
    );
  }

  // Read mode: render lines with checkboxes
  const isEmpty = !value || !value.trim();

  return (
    <div className="checkbox-notes-wrap">
      <div
        className={`checkbox-notes-display ${isEmpty ? 'checkbox-notes-empty' : ''}`}
        onClick={() => !disabled && setEditing(true)}
      >
        {isEmpty ? (
          <span className="checkbox-notes-placeholder">{placeholder}</span>
        ) : (
          lines.map((line, i) => {
            const checkMatch = line.match(/^\[([ x])\] (.*)/);
            if (checkMatch) {
              const checked = checkMatch[1] === 'x';
              const text = checkMatch[2];
              return (
                <div
                  key={i}
                  className={`checkbox-notes-line checkbox-notes-checkbox ${checked ? 'checkbox-notes-checked' : ''}`}
                  onClick={e => { e.stopPropagation(); toggleLine(i); }}
                >
                  {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                  <span className={checked ? 'checkbox-notes-strikethrough' : ''}>{text}</span>
                </div>
              );
            }
            return (
              <div key={i} className="checkbox-notes-line">
                {line || '\u00A0'}
              </div>
            );
          })
        )}
      </div>
      {!disabled && (
        <button type="button" className="checkbox-notes-add-btn" onClick={addCheckbox} title="Checkbox hinzufügen">
          <ListChecks size={14} /> Checkbox
        </button>
      )}
    </div>
  );
}

export default CheckboxNotes;
