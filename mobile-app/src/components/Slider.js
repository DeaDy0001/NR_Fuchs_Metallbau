import React, { useRef } from 'react';
import { View, Text, StyleSheet, PanResponder, Dimensions } from 'react-native';
import { colors } from '../theme/colors';

export default function Slider({ value, min = 0, max = 100, step = 1, onValueChange, leftLabel, rightLabel }) {
  const trackRef = useRef(null);
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleTouch(evt),
      onPanResponderMove: (evt) => handleTouch(evt),
    })
  ).current;

  const handleTouch = (evt) => {
    if (!trackRef.current) return;
    trackRef.current.measure((x, y, width, height, pageX) => {
      const touchX = evt.nativeEvent.pageX - pageX;
      const ratio = Math.max(0, Math.min(1, touchX / width));
      let newValue = min + ratio * (max - min);
      newValue = Math.round(newValue / step) * step;
      newValue = Math.max(min, Math.min(max, newValue));
      if (newValue !== value) onValueChange(newValue);
    });
  };

  return (
    <View style={styles.container}>
      {leftLabel && <Text style={styles.label}>{leftLabel}</Text>}
      <View ref={trackRef} style={styles.track} {...panResponder.panHandlers}>
        <View style={[styles.fill, { width: `${percentage}%` }]} />
        <View style={[styles.thumb, { left: `${percentage}%` }]} />
      </View>
      {rightLabel && <Text style={[styles.label, styles.labelRight]}>{rightLabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 10,
  },
  label: {
    fontSize: 12,
    color: colors.textTertiary,
    minWidth: 35,
  },
  labelRight: {
    textAlign: 'right',
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgTertiary,
    borderRadius: 3,
    position: 'relative',
    justifyContent: 'center',
  },
  fill: {
    height: 6,
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    marginLeft: -11,
    top: -8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
