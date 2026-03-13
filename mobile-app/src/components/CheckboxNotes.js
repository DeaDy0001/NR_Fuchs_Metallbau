import React, { useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

/**
 * CheckboxNotes – renders [ ] / [x] lines as interactive checkboxes.
 * Plain text lines render as editable text inputs.
 * No raw "text mode" – checkboxes are always visible as icons.
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
 *   inputRef      – ref forwarded to first input (for external focus)
 */
export default function CheckboxNotes({
  value = '',
  onChange,
  placeholder = 'Notizen eingeben...',
  editable = true,
  autoFocus = false,
  minHeight = 100,
  inputRef: externalRef,
}) {
  const lineRefs = useRef({});
  const lines = (value || '').split('\n');
  const isEmpty = !value || !value.trim();

  const updateLine = useCallback((index, newLine) => {
    const updated = lines.map((l, i) => (i === index ? newLine : l));
    onChange(updated.join('\n'));
  }, [lines, onChange]);

  const toggleCheckbox = useCallback((index) => {
    if (!editable) return;
    const line = lines[index];
    if (line.startsWith('[ ] ')) updateLine(index, '[x] ' + line.substring(4));
    else if (line.startsWith('[x] ')) updateLine(index, '[ ] ' + line.substring(4));
  }, [lines, updateLine, editable]);

  const handleLineSubmit = useCallback((index) => {
    const line = lines[index];
    const isCheckbox = line.startsWith('[ ] ') || line.startsWith('[x] ');
    const updated = [...lines];
    updated.splice(index + 1, 0, isCheckbox ? '[ ] ' : '');
    onChange(updated.join('\n'));
    setTimeout(() => lineRefs.current[index + 1]?.focus(), 50);
  }, [lines, onChange]);

  const removeLine = useCallback((index) => {
    if (lines.length <= 1) { onChange(''); return; }
    const updated = lines.filter((_, i) => i !== index);
    onChange(updated.join('\n'));
    setTimeout(() => lineRefs.current[Math.max(0, index - 1)]?.focus(), 50);
  }, [lines, onChange]);

  const addCheckbox = useCallback(() => {
    if (!editable) return;
    const newVal = value ? value + '\n[ ] ' : '[ ] ';
    onChange(newVal);
    const newIndex = newVal.split('\n').length - 1;
    setTimeout(() => lineRefs.current[newIndex]?.focus(), 100);
  }, [value, onChange, editable]);

  // Non-editable empty state
  if (!editable && isEmpty) {
    return (
      <View style={[styles.container, { minHeight }]}>
        <Text style={styles.placeholder}>{placeholder}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { minHeight }]}>
      {lines.map((line, i) => {
        const checkMatch = line.match(/^\[([ x])\] (.*)/s);
        if (checkMatch) {
          const checked = checkMatch[1] === 'x';
          const text = checkMatch[2];
          return (
            <View key={i} style={styles.checkboxRow}>
              <TouchableOpacity
                onPress={() => toggleCheckbox(i)}
                disabled={!editable}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? (colors.success || '#22c55e') : (colors.accent || '#3b82f6')}
                />
              </TouchableOpacity>
              {editable ? (
                <TextInput
                  ref={(r) => {
                    lineRefs.current[i] = r;
                    if (i === 0 && externalRef) externalRef.current = r;
                  }}
                  style={[styles.checkboxInput, checked && styles.checkedInput]}
                  value={text}
                  onChangeText={(t) => updateLine(i, (checked ? '[x] ' : '[ ] ') + t)}
                  onSubmitEditing={() => handleLineSubmit(i)}
                  blurOnSubmit={false}
                  returnKeyType="next"
                  multiline={false}
                  autoFocus={autoFocus && i === 0}
                />
              ) : (
                <Text style={[styles.lineText, checked && styles.checked]}>{text}</Text>
              )}
              {editable && (
                <TouchableOpacity
                  onPress={() => removeLine(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                >
                  <Ionicons name="close-circle-outline" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          );
        }

        // Plain text line
        if (editable) {
          return (
            <TextInput
              key={i}
              ref={(r) => {
                lineRefs.current[i] = r;
                if (i === 0 && externalRef) externalRef.current = r;
              }}
              style={styles.textLineInput}
              value={line}
              onChangeText={(t) => updateLine(i, t)}
              onSubmitEditing={() => handleLineSubmit(i)}
              blurOnSubmit={false}
              returnKeyType="next"
              multiline={false}
              autoFocus={autoFocus && i === 0}
              placeholder={i === 0 && isEmpty ? placeholder : ''}
              placeholderTextColor={colors.textTertiary}
            />
          );
        }
        return (
          <Text key={i} style={styles.lineText}>{line || ' '}</Text>
        );
      })}
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
  container: {
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  checkboxInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 2,
  },
  checkedInput: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  textLineInput: {
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 3,
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
    marginTop: 8,
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
