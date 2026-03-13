// Must be imported first so the background task is defined before any rendering
import './src/services/backgroundSync';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator, Platform, ScrollView, TouchableOpacity, Text, Image, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/contexts/AppContext';
import { colors } from './src/theme/colors';
import ErrorBoundary from './src/components/ErrorBoundary';
import { DialogProvider } from './src/components/CustomDialog';

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
const ProjectsStack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.bgSecondary },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontWeight: '600' },
};

// Tab config with action tabs (Camera navigates to stack screen)
const TAB_CONFIG = {
  Home: { icon: 'home', iconOutline: 'home-outline', label: 'Start' },
  Camera: { icon: 'camera', iconOutline: 'camera-outline', label: 'Foto', isAction: true },
  Projects: { icon: 'folder', iconOutline: 'folder-outline', label: 'Projekte' },
  Queue: { icon: 'cloud-upload', iconOutline: 'cloud-upload-outline', label: 'Upload' },
  Settings: { icon: 'settings', iconOutline: 'settings-outline', label: 'Einstellungen' },
};

function CustomTabBar({ state, descriptors, navigation }) {
  const { queueCount } = useApp();
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <View style={{
      backgroundColor: colors.bgSecondary,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      paddingBottom: bottomPadding,
    }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 4,
          paddingTop: 8,
          paddingBottom: 4,
          minWidth: '100%',
          justifyContent: 'space-evenly',
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const config = TAB_CONFIG[route.name] || {};
          const isFocused = state.index === index;
          const color = isFocused ? colors.accent : colors.textTertiary;
          const iconName = isFocused ? config.icon : config.iconOutline;
          const showBadge = route.name === 'Queue' && queueCount > 0;

          const onPress = () => {
            if (config.isAction) {
              // Action tabs navigate to stack screens instead of switching tabs
              if (route.name === 'Camera') {
                navigation.navigate('CameraStack');
              }
              return;
            }
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!event.defaultPrevented) {
              if (!isFocused) {
                // Switching to this tab - for nested stack tabs, always reset to root screen
                if (route.name === 'Projects') {
                  navigation.navigate('Projects', { screen: 'ProjectsList' });
                } else {
                  navigation.navigate(route.name);
                }
              } else if (route.name === 'Projects') {
                // Already on Projects tab, tapped again - go back to project list
                navigation.navigate('Projects', { screen: 'ProjectsList' });
              }
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={{
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingVertical: 4,
                minWidth: 56,
              }}
            >
              <View style={{ position: 'relative' }}>
                <Ionicons name={iconName} size={22} color={color} />
                {showBadge && (
                  <View style={{
                    position: 'absolute', top: -4, right: -10,
                    backgroundColor: colors.warning, borderRadius: 8,
                    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 3,
                  }}>
                    <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>
                      {queueCount > 99 ? '99+' : queueCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 10, fontWeight: '500', color, marginTop: 3 }}>
                {config.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Dummy components for action tabs (they navigate away, these are never really shown)
function DummyScreen() { return <View style={{ flex: 1, backgroundColor: colors.bgPrimary }} />; }

function ProjectsStackScreen() {
  return (
    <ProjectsStack.Navigator screenOptions={screenOptions}>
      <ProjectsStack.Screen
        name="ProjectsList"
        component={ProjectsScreen}
        options={{ title: 'Projekte' }}
      />
      <ProjectsStack.Screen
        name="ProjectDetail"
        component={ProjectDetailScreen}
        options={({ route }) => ({
          title: route.params?.projectName || 'Projekt',
        })}
      />
    </ProjectsStack.Navigator>
  );
}

function UpdateBanner({ navigation }) {
  const { updateAvailable, updateInfo } = useApp();
  if (!updateAvailable || !updateInfo) return null;

  return (
    <TouchableOpacity
      style={bannerStyles.banner}
      onPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      activeOpacity={0.85}
    >
      <Ionicons name="arrow-up-circle" size={16} color="white" />
      <Text style={bannerStyles.text}>
        Update verfügbar: v{updateInfo.version} – Tippen zum Installieren
      </Text>
    </TouchableOpacity>
  );
}

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#16a34a',
  },
  text: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});

function MainTabs({ navigation }) {
  return (
    <View style={{ flex: 1 }}>
      <UpdateBanner navigation={navigation} />
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={screenOptions}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Start',
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image
                source={require('./assets/splash-icon.png')}
                style={{ height: 32, width: 32, borderRadius: 8 }}
                resizeMode="cover"
              />
              <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '700' }}>
                Fuchs Metallbau
              </Text>
            </View>
          ),
          headerTitleAlign: 'center',
        }}
      />
      <Tab.Screen name="Camera" component={DummyScreen} options={{ tabBarLabel: 'Foto' }} />
      <Tab.Screen
        name="Projects"
        component={ProjectsStackScreen}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Queue"
        component={UploadQueueScreen}
        options={{ title: 'Upload-Warteschlange' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Einstellungen' }}
      />
    </Tab.Navigator>
    </View>
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
            name="CameraStack"
            component={CameraScreen}
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="ImageView"
            component={ImageViewScreen}
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <ErrorBoundary>
      <AppProvider>
        <DialogProvider>
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
        </DialogProvider>
      </AppProvider>
    </ErrorBoundary>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
