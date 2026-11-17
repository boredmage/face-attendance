/**
 * Password reset, step 1: a student gives their matric number or email, a lecturer their email.
 * A 6-digit code goes to the account's address and ResetPassword takes over. Reached from Login,
 * with the role of the tab that was open.
 */
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Spinner } from 'heroui-native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { passwordApi } from '@/api/endpoints';
import { FormField, Screen } from '@/components/ui';
import type { AuthStackParamList } from '@/navigation/types';

export function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { params } = useRoute<RouteProp<AuthStackParamList, 'ForgotPassword'>>();
  const student = params.role === 'student';
  const [identifier, setIdentifier] = useState(params.identifier ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    const value = identifier.trim();
    if (student ? value.length < 3 : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setFieldError(student ? 'Enter your matric number or email' : 'Enter the email you registered with');
      return;
    }
    setFieldError(null);
    setError(null);
    setLoading(true);
    try {
      const pending = await passwordApi.forgot(params.role, value);
      navigation.navigate('ResetPassword', {
        role: params.role,
        identifier: value,
        resetId: pending.reset_id,
        resendInSeconds: pending.resend_in_seconds,
        codeMinutes: pending.code_minutes,
      });
    } catch (err) {
      setError(errorMessage(err, 'Could not send a code'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="grow px-5 py-6" keyboardShouldPersistTaps="handled">
          <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
            {student ? 'Student account' : 'Lecturer account'}
          </Text>
          <Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">Reset your password</Text>
          <Text className="mb-6 mt-1 text-sm text-muted">
            {student
              ? "Enter your matric number or email. We'll send a 6-digit code to the email on your account."
              : "Enter the email you registered with. We'll send you a 6-digit code."}
          </Text>

          <Card className="p-5">
            {student ? (
              <FormField
                label="Matric number or email"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="Matric number or email"
                error={fieldError}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={submit}
              />
            ) : (
              <FormField
                label="Staff email"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@ui.edu.ng"
                error={fieldError}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={submit}
              />
            )}

            {error ? (
              <Alert status="danger" className="mb-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}

            <Button size="lg" onPress={submit} isDisabled={loading}>
              {loading ? <Spinner color="white" /> : 'Send code'}
            </Button>
          </Card>

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Remembered it?</Text>
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Log in
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
