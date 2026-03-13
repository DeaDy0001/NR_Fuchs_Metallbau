import { useState, useRef, useCallback } from 'react';
import { CheckSquare, Square, Plus, X } from 'lucide-react';
import './CheckboxNotes.css';

/**
 * CheckboxNotes – two separate areas:
 *   1. Free-text notes (textarea, click to edit)
 *   2. Checklist (always-interactive checkboxes, add/remove/toggle)
 *
 * Storage format (plain text, unchanged):
 *   Normal text line
 *   [ ] unchecked item
 *   [x] checked item
 *
 * Props:
 *   value      – string  (the notes text)
 *   onChange   – fn(newValue)  called whenever content changes
 *   placeholder – string
 *   disabled   – boolean
 */
function CheckboxNotes({ value = '', onChange, placeholder = 'Notizen eingeben...', disabled = false }) {
  const [editingText, setEditingText] = useState(false);
  const [newCheckboxText, setNewCheckboxText] = useState('');
  const textareaRef = useRef(null);
  const addInputRef = useRef(null);

  const lines = (value || '').split('\n');
  const checkboxLines = lines.filter(l => /^\[[ x]\] /.test(l));
  const textLines = lines.filter(l => !/^\[[ x]\] /.test(l));
  const textValue = textLines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/, '');

  // Rebuild the full notes string: text first, then checkboxes
  const buildValue = useCallback((newText, newCheckboxes) => {
    const parts = [];
    if (newText.trim()) parts.push(newText.trim());
    if (newCheckboxes.length > 0) parts.push(newCheckboxes.join('\n'));
    return parts.join('\n');
  }, []);

  const handleTextChange = (newText) => {
    onChange(buildValue(newText, checkboxLines));
  };

  const toggleCheckbox = (index) => {
    if (disabled) return;
    const updated = checkboxLines.map((line, i) => {
      if (i !== index) return line;
      if (line.startsWith('[ ] ')) return '[x] ' + line.substring(4);
      if (line.startsWith('[x] ')) return '[ ] ' + line.substring(4);
      return line;
    });
    onChange(buildValue(textValue, updated));
  };

  const addCheckbox = () => {
    if (disabled || !newCheckboxText.trim()) return;
    const updated = [...checkboxLines, '[ ] ' + newCheckboxText.trim()];
    onChange(buildValue(textValue, updated));
    setNewCheckboxText('');
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const removeCheckbox = (index) => {
    if (disabled) return;
    const updated = checkboxLines.filter((_, i) => i !== index);
    onChange(buildValue(textValue, updated));
  };

  const handleAddKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCheckbox();
    }
  };

  return (
    <div className="checkbox-notes-wrap">
      {/* ── Text notes ── */}
      {editingText ? (
        <textarea
          ref={textareaRef}
          className="checkbox-notes-textarea"
          value={textValue}
          onChange={e => handleTextChange(e.target.value)}
          onBlur={() => setEditingText(false)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus
        />
      ) : (
        <div
          className={`checkbox-notes-display ${!textValue.trim() ? 'checkbox-notes-empty' : ''}`}
          onClick={() => !disabled && setEditingText(true)}
        >
          {textValue.trim() ? (
            textValue.split('\n').map((line, i) => (
              <div key={i} className="checkbox-notes-line">{line || '\u00A0'}</div>
            ))
          ) : (
            <span className="checkbox-notes-placeholder">{placeholder}</span>
          )}
        </div>
      )}

      {/* ── Checklist (always visible) ── */}
      {(!disabled || checkboxLines.length > 0) && (
        <div className="checkbox-notes-checklist">
          {checkboxLines.length > 0 && (
            <div className="checkbox-notes-items">
              {checkboxLines.map((line, i) => {
                const match = line.match(/^\[([ x])\] (.*)/);
                const checked = match ? match[1] === 'x' : false;
                const text = match ? match[2] : line;
                return (
                  <div key={i} className={`checkbox-notes-item${checked ? ' checkbox-notes-item-checked' : ''}`}>
                    <button
                      type="button"
                      className="checkbox-notes-toggle"
                      onClick={() => toggleCheckbox(i)}
                      disabled={disabled}
                      title={checked ? 'Abhaken rückgängig' : 'Abhaken'}
                    >
                      {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span className={`checkbox-notes-item-text${checked ? ' checkbox-notes-strikethrough' : ''}`}>
                      {text}
                    </span>
                    {!disabled && (
                      <button
                        type="button"
                        className="checkbox-notes-remove"
                        onClick={() => removeCheckbox(i)}
                        title="Entfernen"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!disabled && (
            <div className="checkbox-notes-add-row">
              <input
                ref={addInputRef}
                className="checkbox-notes-add-input"
                type="text"
                value={newCheckboxText}
                onChange={e => setNewCheckboxText(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="Neue Checkbox..."
                disabled={disabled}
              />
              <button
                type="button"
                className="checkbox-notes-add-btn"
                onClick={addCheckbox}
                disabled={!newCheckboxText.trim()}
                title="Checkbox hinzufügen"
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CheckboxNotes;
