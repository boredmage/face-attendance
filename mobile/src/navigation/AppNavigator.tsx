/**
 * Root navigation, chosen by auth state:
 *   - signed out:                     Login | Register
 *   - student without an enrolled face: FaceIntro -> EnrolFace (mandatory, nothing else reachable)
 *   - student:                        bottom tabs (Home, Courses, Lecturers, Profile) + CourseDetail / Catalog / EnrolFace on top
 *   - lecturer:                       attendance-taking only (course list -> scanner -> summary)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { LoadingState } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { CatalogScreen } from '@/screens/CatalogScreen';
import { CourseDetailScreen } from '@/screens/CourseDetailScreen';
import { CoursesScreen } from '@/screens/CoursesScreen';
import { EnrolFaceScreen } from '@/screens/EnrolFaceScreen';
import { FaceIntroScreen } from '@/screens/FaceIntroScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { LecturersScreen } from '@/screens/LecturersScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { LecturerHomeScreen } from '@/screens/lecturer/LecturerHomeScreen';
import { SessionSummaryScreen } from '@/screens/lecturer/SessionSummaryScreen';
import { TakeAttendanceScreen } from '@/screens/lecturer/TakeAttendanceScreen';
import { colors } from '@/theme';

import type {
  AuthStackParamList,
  FaceSetupStackParamList,
  LecturerStackParamList,
  RootStackParamList,
  TabParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const FaceStack = createNativeStackNavigator<FaceSetupStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const LecturerStack = createNativeStackNavigator<LecturerStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<keyof TabParamList, [IconName, IconName]> = {
  Home: ['home', 'home-outline'],
  Courses: ['book', 'book-outline'],
  Lecturers: ['people', 'people-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};

// Native stack headers: light, with the navy accent for the back button
const headerStyle = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.navy,
  headerTitleStyle: { color: colors.foreground, fontWeight: '600' as const },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal' as const,
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: '#71717A',
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: '#E4E4E7' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, focused, size }) => (
          <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Courses" component={CoursesScreen} />
      <Tab.Screen name="Lecturers" component={LecturersScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.background, primary: colors.navy } };

function Navigator() {
  const { session } = useAuth();

  if (!session) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
        <AuthStack.Screen name="Register" component={RegisterScreen} />
      </AuthStack.Navigator>
    );
  }

  if (session.role === 'lecturer') {
    return (
      <LecturerStack.Navigator screenOptions={headerStyle}>
        <LecturerStack.Screen name="LecturerHome" component={LecturerHomeScreen} options={{ headerShown: false }} />
        <LecturerStack.Screen name="TakeAttendance" component={TakeAttendanceScreen} options={{ headerShown: false }} />
        <LecturerStack.Screen
          name="SessionSummary"
          component={SessionSummaryScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </LecturerStack.Navigator>
    );
  }

  if (!session.student.face_enrolled) {
    return (
      <FaceStack.Navigator screenOptions={headerStyle}>
        <FaceStack.Screen name="FaceIntro" component={FaceIntroScreen} options={{ headerShown: false }} />
        <FaceStack.Screen name="EnrolFace" component={EnrolFaceScreen} options={{ title: 'Register your face' }} />
      </FaceStack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="CourseDetail" component={CourseDetailScreen} options={({ route }) => ({ title: route.params.code })} />
      <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: 'Browse courses' }} />
      <Stack.Screen name="EnrolFace" component={EnrolFaceScreen} options={{ title: 'Re-enrol your face' }} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const { loading } = useAuth();
  if (loading) return <LoadingState message="Starting…" />;
  return (
    <NavigationContainer theme={navTheme}>
      <Navigator />
    </NavigationContainer>
  );
}
