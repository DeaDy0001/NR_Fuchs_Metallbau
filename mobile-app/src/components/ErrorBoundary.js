import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('=== APP CRASH ===');
    console.error('Error:', error?.message || error);
    console.error('Stack:', error?.stack);
    console.error('Component Stack:', errorInfo?.componentStack);
    console.error('=================');
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || this.state.error?.toString?.() || 'Unbekannter Fehler';
      const errorStack = this.state.error?.stack || '';
      const componentStack = this.state.errorInfo?.componentStack || '';

      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠</Text>
          <Text style={styles.title}>App-Fehler</Text>
          <Text style={styles.subtitle}>
            Die App ist auf einen Fehler gestoßen.
          </Text>
          <ScrollView style={styles.errorBox}>
            <Text style={styles.errorLabel}>Fehler:</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            {errorStack ? (
              <>
                <Text style={styles.errorLabel}>{'\n'}Stack Trace:</Text>
                <Text style={styles.stackText}>{errorStack}</Text>
              </>
            ) : null}
            {componentStack ? (
              <>
                <Text style={styles.errorLabel}>{'\n'}Component:</Text>
                <Text style={styles.stackText}>{componentStack}</Text>
              </>
            ) : null}
          </ScrollView>
          <TouchableOpacity
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null, errorInfo: null })}
          >
            <Text style={styles.buttonText}>Erneut versuchen</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#e2e8f0', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginBottom: 16 },
  errorBox: {
    maxHeight: 200,
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 24,
  },
  errorLabel: { fontSize: 13, color: '#94a3b8', fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
  errorText: { fontSize: 13, color: '#ef4444', fontFamily: 'monospace' },
  stackText: { fontSize: 11, color: '#f59e0b', fontFamily: 'monospace', lineHeight: 16 },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
