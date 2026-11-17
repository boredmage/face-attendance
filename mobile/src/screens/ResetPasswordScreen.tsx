/**
 * Password reset, step 2: the 6-digit code that was emailed, and the new password. Setting it signs
 * out every earlier session (a lecturer's other phone included), so the person logs in again on Login.
 */
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Spinner } from 'heroui-native';
import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { errorMessage, retryAfterSeconds } from '@/api/client';
import { passwordApi } from '@/api/endpoints';
import { FormField, Screen } from '@/components/ui';
import type { AuthStackParamList } from '@/navigation/types';

const CODE_LENGTH = 6;
/** Students' passwords need 6 characters, lecturers' 8 (as when registering) */
const MIN_PASSWORD = { student: 6, lecturer: 8 } as const;
/** What is kept of what was typed or pasted: its first 6 digits (so pasting the email's whole line works) */
const digits = (text: string) => text.replace(/\D/g, '').slice(0, CODE_LENGTH);

type Errors = Partial<Record<'code' | 'password' | 'confirm', string>>;

export function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { params } = useRoute<RouteProp<AuthStackParamList, 'ResetPassword'>>();
  const minimum = MIN_PASSWORD[params.role];
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(Date.now());
  // When another code may be requested
  const [resendAt, setResendAt] = useState(now + params.resendInSeconds * 1000);

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const waiting = secondsLeft > 0;

  // Counts the wait down, once a second
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const startWait = (seconds: number) => {
    const from = Date.now();
    setNow(from);
    setResendAt(from + seconds * 1000);
  };

  const changeCode = (text: string) => {
    const next = digits(text);
    setCode(next);
    // The number pad has no return key on iOS: put it away once the code is complete
    if (next.length === CODE_LENGTH && code.length < CODE_LENGTH) Keyboard.dismiss();
  };

  const submit = async () => {
    // A new code is on its way (or this one is being checked): what is in the field is about to change
    if (loading || resending) return;
    const e: Errors = {};
    if (code.length !== CODE_LENGTH) e.code = 'Enter the 6-digit code from the email';
    if (password.length < minimum) e.password = `At least ${minimum} characters`;
    if (confirm !== password) e.confirm = 'Passwords do not match';
    setErrors(e);
    if (Object.keys(e).length) return;
    setError(null);
    setLoading(true);
    try {
      await passwordApi.reset(params.resetId, code, password);
      navigation.popTo('Login', { notice: 'Password changed. Log in with your new password.' });
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password'));
      setSent(false);
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setSent(false);
    setResending(true);
    try {
      const pending = await passwordApi.resendCode(params.resetId);
      setCode('');
      setErrors((current) => ({ ...current, code: undefined }));
      setSent(true);
      startWait(pending.resend_in_seconds);
    } catch (err) {
      const retryIn = retryAfterSeconds(err);
      // Asked too soon: the button counts the wait down itself, from the server's number
      if (retryIn !== null) startWait(retryIn);
      else setError(errorMessage(err, 'Could not send a new code'));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="grow px-5 py-6" keyboardShouldPersistTaps="handled">
          <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
            {params.role === 'student' ? 'Student account' : 'Lecturer account'}
          </Text>
          <Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">Choose a new password</Text>
          <Text className="mb-6 mt-1 text-sm text-muted">
            If an account matches {params.identifier}, we sent a 6-digit code to its email. The code works for{' '}
            {params.codeMinutes} minute{params.codeMinutes === 1 ? '' : 's'}.
          </Text>

          <Card className="p-5">
            <FormField
              label="Reset code"
              value={code}
              onChangeText={changeCode}
              placeholder="6-digit code"
              error={errors.code}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
            <FormField
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${minimum} characters`}
              error={errors.password}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <FormField
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              error={errors.confirm}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {sent ? (
              <Alert status="success" className="mb-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>A new code is on its way.</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}

            {error ? (
              <Alert status="danger" className="mb-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}

            <Button size="lg" onPress={submit} isDisabled={loading || resending}>
              {loading ? <Spinner color="white" /> : 'Set new password'}
            </Button>
          </Card>

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Didn't get the email?</Text>
            <Button variant="ghost" size="sm" onPress={resend} isDisabled={waiting || resending || loading}>
              {resending ? 'Sending…' : waiting ? `Send again in ${secondsLeft}s` : 'Send a new code'}
            </Button>
          </View>
          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Typed it wrong?</Text>
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Start again
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
