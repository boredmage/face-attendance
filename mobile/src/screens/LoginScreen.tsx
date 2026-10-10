/**
 * University-branded login with a Student | Lecturer switch.
 *
 * Students sign in with matric number + password (or create an account). Lecturers sign in with
 * the email + password they registered on the web dashboard; in the app they can only take attendance.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Spinner, Tabs } from 'heroui-native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { FormField, Icon, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import type { AuthStackParamList } from '@/navigation/types';

type Role = 'student' | 'lecturer';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { loginStudent, loginLecturer } = useAuth();
  const [role, setRole] = useState<Role>('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchRole = (r: string) => {
    setRole(r as Role);
    setIdentifier('');
    setError(null);
  };

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError(role === 'student' ? 'Please enter your matric number and password.' : 'Please enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // On success AuthProvider updates the session and AppNavigator switches screens
      if (role === 'student') await loginStudent(identifier, password);
      else await loginLecturer(identifier, password);
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="grow justify-center px-5 py-8" keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View className="mb-8 items-center">
            <View className="mb-4 size-20 items-center justify-center rounded-3xl bg-accent">
              <Icon name="scan" size={38} color="accent-foreground" />
            </View>
            <Text className="text-2xl font-bold tracking-tight text-foreground">University of Ibadan</Text>
            <Text className="mt-1 text-sm text-muted">Face Recognition Attendance</Text>
          </View>

          <Card className="gap-1 p-5">
            <Tabs value={role} onValueChange={switchRole} className="mb-5">
              <Tabs.List className="w-full">
                <Tabs.Indicator />
                <Tabs.Trigger value="student" className="flex-1">
                  <Tabs.Label>Student</Tabs.Label>
                </Tabs.Trigger>
                <Tabs.Trigger value="lecturer" className="flex-1">
                  <Tabs.Label>Lecturer</Tabs.Label>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>

            {role === 'student' ? (
              <FormField
                label="Matric number"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="e.g. CSC/2021/001"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
              />
            ) : (
              <FormField
                label="Staff email"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@ui.edu.ng"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
            )}
            <FormField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {error ? (
              <Alert status="danger" className="mb-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}

            <Button size="lg" onPress={submit} isDisabled={loading}>
              {loading ? <Spinner color="white" /> : role === 'student' ? 'Log in' : 'Log in to take attendance'}
            </Button>

            {role === 'student' ? (
              <View className="mt-4 flex-row items-center justify-center gap-1">
                <Text className="text-sm text-muted">New student?</Text>
                <Button variant="ghost" size="sm" onPress={() => navigation.navigate('Register')}>
                  Create account
                </Button>
              </View>
            ) : (
              <Alert status="accent" className="mt-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>
                    Lecturers only take attendance in the app. Register and manage courses on the web dashboard.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
