import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions } from 'react-native';
import { colors } from '../theme/colors';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialogs, setDialogs] = useState([]);

  const showDialog = useCallback(({ title, message, buttons = [{ text: 'OK' }], type = 'default' }) => {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      setDialogs(prev => [...prev, { id, title, message, buttons, type, resolve }]);
    });
  }, []);

  // Drop-in replacement for Alert.alert
  const alert = useCallback((title, message, buttons, options) => {
    if (!buttons || buttons.length === 0) {
      buttons = [{ text: 'OK' }];
    }

    const type = buttons.some(b => b.style === 'destructive') ? 'destructive' : 'default';

    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      const wrappedButtons = buttons.map(btn => ({
        ...btn,
        onPress: () => {
          if (btn.onPress) btn.onPress();
          resolve(btn.text);
        },
      }));
      setDialogs(prev => [...prev, { id, title, message, buttons: wrappedButtons, type, resolve }]);
    });
  }, []);

  const dismissDialog = useCallback((id) => {
    setDialogs(prev => prev.filter(d => d.id !== id));
  }, []);

  return (
    <DialogContext.Provider value={{ showDialog, alert }}>
      {children}
      {dialogs.map(dialog => (
        <DialogModal key={dialog.id} dialog={dialog} onDismiss={() => dismissDialog(dialog.id)} />
      ))}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

function DialogModal({ dialog, onDismiss }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePress = (btn) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      if (btn.onPress) btn.onPress();
      onDismiss();
    });
  };

  const handleCancel = () => {
    const cancelBtn = dialog.buttons.find(b => b.style === 'cancel');
    if (cancelBtn) {
      handlePress(cancelBtn);
    }
  };

  const isDestructive = dialog.type === 'destructive';
  const accentColor = isDestructive ? colors.error : colors.accent;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.overlayTouch} activeOpacity={1} onPress={handleCancel} />
        <Animated.View style={[styles.dialog, { transform: [{ scale: scaleAnim }] }]}>
          {/* Accent line at top */}
          <View style={[styles.accentLine, { backgroundColor: accentColor }]} />

          <View style={styles.content}>
            {dialog.title && (
              <Text style={styles.title}>{dialog.title}</Text>
            )}
            {dialog.message && (
              <Text style={styles.message}>{dialog.message}</Text>
            )}
          </View>

          <View style={[styles.buttonRow, dialog.buttons.length > 2 && styles.buttonColumn]}>
            {dialog.buttons.map((btn, i) => {
              const isCancel = btn.style === 'cancel';
              const isDestBtn = btn.style === 'destructive';

              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.button,
                    dialog.buttons.length > 2 && styles.buttonFull,
                    isCancel && styles.buttonCancel,
                    isDestBtn && styles.buttonDestructive,
                    !isCancel && !isDestBtn && styles.buttonPrimary,
                  ]}
                  onPress={() => handlePress(btn)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.buttonText,
                    isCancel && styles.buttonTextCancel,
                    isDestBtn && styles.buttonTextDestructive,
                    !isCancel && !isDestBtn && styles.buttonTextPrimary,
                  ]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const { width: screenWidth } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    width: Math.min(screenWidth - 48, 340),
    backgroundColor: colors.bgSecondary,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  accentLine: {
    height: 3,
    width: '100%',
  },
  content: {
    padding: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    padding: 12,
    paddingTop: 0,
    gap: 8,
  },
  buttonColumn: {
    flexDirection: 'column',
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonFull: {
    flex: 0,
  },
  buttonCancel: {
    backgroundColor: colors.bgTertiary,
  },
  buttonDestructive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextCancel: {
    color: colors.textSecondary,
  },
  buttonTextDestructive: {
    color: colors.error,
  },
  buttonTextPrimary: {
    color: '#ffffff',
  },
});
