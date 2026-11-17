/**
 * Step 2 of registration: the student enters the 6-digit code emailed to them. Confirming it creates
 * the account and signs them in, and the navigator moves on to the (mandatory) face-enrolment flow.
 * Also reached from Login, when a sign-up was started but its email never confirmed.
 */
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Button, Card, Spinner } from 'heroui-native';
import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { errorMessage, retryAfterSeconds } from '@/api/client';
import { studentApi } from '@/api/endpoints';
import { FormField, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import type { AuthStackParamList } from '@/navigation/types';

const CODE_LENGTH = 6;
/** What is kept of what was typed or pasted: its first 6 digits (so pasting the email's whole line works) */
const digits = (text: string) => text.replace(/\D/g, '').slice(0, CODE_LENGTH);

export function VerifyEmailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { params } = useRoute<RouteProp<AuthStackParamList, 'VerifyEmail'>>();
  const { verifyStudentEmail } = useAuth();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
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
    // The number pad has no return key on iOS: put it away once the code is complete, so the button is in reach
    if (next.length === CODE_LENGTH && code.length < CODE_LENGTH) Keyboard.dismiss();
  };

  const submit = async () => {
    // A new code is on its way (or this one is being checked): what is in the field is about to change
    if (loading || resending) return;
    if (code.length !== CODE_LENGTH) {
      setCodeError('Enter the 6-digit code from the email');
      return;
    }
    setCodeError(null);
    setError(null);
    setLoading(true);
    try {
      await verifyStudentEmail(params.verificationId, code);
      // AppNavigator now shows the face-enrolment flow
    } catch (err) {
      setError(errorMessage(err, 'Could not confirm your email'));
      setSent(false);
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setSent(false);
    setResending(true);
    try {
      const pending = await studentApi.resendCode(params.verificationId);
      setCode('');
      setCodeError(null);
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
          <Text className="text-xs font-semibold uppercase tracking-wider text-accent">Step 2 of 3</Text>
          <Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">Confirm your email</Text>
          <Text className="mb-6 mt-1 text-sm text-muted">
            We sent a 6-digit code to {params.email}. Enter it to finish creating your account. The code works for{' '}
            {params.codeMinutes} minute{params.codeMinutes === 1 ? '' : 's'}.
          </Text>

          <Card className="p-5">
            <FormField
              label="Confirmation code"
              value={code}
              onChangeText={changeCode}
              placeholder="6-digit code"
              error={codeError}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
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
              {loading ? <Spinner color="white" /> : 'Confirm email'}
            </Button>
          </Card>

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Didn't get the email?</Text>
            <Button variant="ghost" size="sm" onPress={resend} isDisabled={waiting || resending || loading}>
              {resending ? 'Sending…' : waiting ? `Send again in ${secondsLeft}s` : 'Send a new code'}
            </Button>
          </View>
          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Wrong email address?</Text>
            <Button variant="ghost" size="sm" onPress={() => navigation.popTo('Register')}>
              Change it
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
