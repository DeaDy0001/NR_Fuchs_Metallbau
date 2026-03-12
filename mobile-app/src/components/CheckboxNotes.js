import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

/**
 * CheckboxNotes – a TextInput-like component that renders [ ] / [x] lines as
 * interactive checkboxes.  Plain text lines render normally.
 *
 * Storage format (plain text, markdown-like):
 *   [ ] unchecked item
 *   [x] checked item
 *   Normal text line
 *
 * Props:
 *   value        – string (the notes text)
 *   onChange      – fn(newValue) called whenever content changes
 *   placeholder   – string
 *   editable      – boolean (default true)
 *   autoFocus     – boolean
 *   minHeight     – number (default 100)
 */
export default function CheckboxNotes({
  value = '',
  onChange,
  placeholder = 'Notizen eingeben...',
  editable = true,
  autoFocus = false,
  minHeight = 100,
}) {
  const [editing, setEditing] = useState(autoFocus);
  const inputRef = useRef(null);

  const lines = (value || '').split('\n');

  const toggleLine = useCallback((lineIndex) => {
    if (!editable) return;
    const updated = lines.map((line, i) => {
      if (i !== lineIndex) return line;
      if (line.startsWith('[ ] ')) return '[x] ' + line.substring(4);
      if (line.startsWith('[x] ')) return '[ ] ' + line.substring(4);
      return line;
    });
    onChange(updated.join('\n'));
  }, [lines, onChange, editable]);

  const addCheckbox = useCallback(() => {
    if (!editable) return;
    const newVal = value ? value + '\n[ ] ' : '[ ] ';
    onChange(newVal);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [value, onChange, editable]);

  const handleChangeText = useCallback((text) => {
    onChange(text);
  }, [onChange]);

  // Handle submit editing (Enter key on hardware keyboard)
  const handleSubmitEditing = useCallback(() => {
    // Don't close - just let the multiline handle it
  }, []);

  if (editing) {
    return (
      <View style={styles.wrap}>
        <TextInput
          ref={inputRef}
          style={[styles.textInput, { minHeight }]}
          value={value || ''}
          onChangeText={handleChangeText}
          onBlur={() => setEditing(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          multiline
          autoFocus={autoFocus || true}
          textAlignVertical="top"
          editable={editable}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addCheckbox}>
          <Ionicons name="checkbox-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.addBtnText}>Checkbox</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Read mode: render lines with checkboxes
  const isEmpty = !value || !value.trim();

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.display, { minHeight: Math.max(minHeight, 40) }]}
        onPress={() => editable && setEditing(true)}
        activeOpacity={editable ? 0.7 : 1}
      >
        {isEmpty ? (
          <Text style={styles.placeholder}>{placeholder}</Text>
        ) : (
          lines.map((line, i) => {
            const checkMatch = line.match(/^\[([ x])\] (.*)/);
            if (checkMatch) {
              const checked = checkMatch[1] === 'x';
              const text = checkMatch[2];
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.checkboxLine}
                  onPress={() => toggleLine(i)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={checked ? colors.success || '#22c55e' : colors.accent || '#3b82f6'}
                  />
                  <Text style={[styles.lineText, checked && styles.checked]}>{text}</Text>
                </TouchableOpacity>
              );
            }
            return (
              <Text key={i} style={styles.lineText}>{line || ' '}</Text>
            );
          })
        )}
      </TouchableOpacity>
      {editable && (
        <TouchableOpacity style={styles.addBtn} onPress={addCheckbox}>
          <Ionicons name="checkbox-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.addBtnText}>Checkbox</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  textInput: {
    backgroundColor: colors.bgTertiary || '#1a1a2e',
    borderWidth: 1,
    borderColor: colors.border || '#2a2d3e',
    borderRadius: 8,
    color: colors.textPrimary,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
  },
  display: {
    backgroundColor: colors.bgTertiary || '#1a1a2e',
    borderWidth: 1,
    borderColor: colors.border || '#2a2d3e',
    borderRadius: 8,
    padding: 12,
  },
  placeholder: {
    color: colors.textTertiary,
    fontStyle: 'italic',
    fontSize: 15,
  },
  checkboxLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 2,
  },
  lineText: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  checked: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border || '#2a2d3e',
    borderRadius: 6,
  },
  addBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
});
