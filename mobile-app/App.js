import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/contexts/AppContext';
import { colors } from './src/theme/colors';
import ErrorBoundary from './src/components/ErrorBoundary';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import ConnectScreen from './src/screens/ConnectScreen';
import HomeScreen from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import ProjectDetailScreen from './src/screens/ProjectDetailScreen';
import ImageViewScreen from './src/screens/ImageViewScreen';
import UploadQueueScreen from './src/screens/UploadQueueScreen';
import SettingsScreen from './src/screens/SettingsScreen';

console.log('[Fuchs] App.js module loaded');

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.bgSecondary },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontWeight: '600' },
};

function MainTabs() {
  const { queueCount } = useApp();
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarStyle: {
          backgroundColor: colors.bgSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        ...screenOptions,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          switch (route.name) {
            case 'Home': iconName = focused ? 'home' : 'home-outline'; break;
            case 'Projects': iconName = focused ? 'folder' : 'folder-outline'; break;
            case 'Settings': iconName = focused ? 'settings' : 'settings-outline'; break;
          }
          return <Ionicons name={iconName} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Start', headerTitle: 'Fuchs Metallbau' }}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{ title: 'Projekte' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Einstellungen',
          tabBarBadge: queueCount > 0 ? queueCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, fontSize: 10 },
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { isSetup, isGoogleAuthed, isConnected, isLoading } = useApp();

  console.log('[Fuchs] AppNavigator - isLoading:', isLoading, 'setup:', isSetup, 'authed:', isGoogleAuthed, 'connected:', isConnected);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!isSetup ? (
        // Step 1: Scan QR code from desktop to get Google Client ID + Drive folder
        <Stack.Screen
          name="Connect"
          component={ConnectScreen}
          options={{ headerShown: false }}
        />
      ) : !isGoogleAuthed ? (
        // Step 2: Sign in with Google
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : !isConnected ? (
        // Step 3: If Drive connection failed verification, re-connect
        <Stack.Screen
          name="Connect"
          component={ConnectScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Camera"
            component={CameraScreen}
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="ProjectDetail"
            component={ProjectDetailScreen}
            options={({ route }) => ({
              title: route.params?.projectName || 'Projekt',
            })}
          />
          <Stack.Screen
            name="ImageView"
            component={ImageViewScreen}
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="UploadQueue"
            component={UploadQueueScreen}
            options={{ title: 'Upload-Warteschlange' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  console.log('[Fuchs] App component rendering');

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('overlay-swipe');
      NavigationBar.setBackgroundColorAsync(colors.bgSecondary);
    }
  }, []);

  return (
    <SafeAreaProvider>
    <ErrorBoundary>
      <AppProvider>
        <NavigationContainer
          theme={{
            ...DarkTheme,
            dark: true,
            colors: {
              ...DarkTheme.colors,
              primary: colors.accent,
              background: colors.bgPrimary,
              card: colors.bgSecondary,
              text: colors.textPrimary,
              border: colors.border,
              notification: colors.warning,
            },
          }}
        >
          <StatusBar style="light" hidden={true} translucent={true} />
          <AppNavigator />
        </NavigationContainer>
      </AppProvider>
    </ErrorBoundary>
    </SafeAreaProvider>
  );
}
