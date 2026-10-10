/**
 * Student self-registration. On success the student is signed in and the navigator sends them
 * straight to the (mandatory) face-enrolment flow.
 */
import { useNavigation } from '@react-navigation/native';
import { Alert, Button, Card, Label, Spinner, Tabs } from 'heroui-native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { FormField, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

const LEVELS = ['100', '200', '300', '400', '500'];
const MATRIC_RE = /^[A-Za-z0-9/\-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Form = {
  fullName: string;
  matricNo: string;
  email: string;
  department: string;
  level: string;
  password: string;
  confirm: string;
};
type Errors = Partial<Record<keyof Form, string>>;

function validate(f: Form): Errors {
  const e: Errors = {};
  if (f.fullName.trim().split(/\s+/).length < 2) e.fullName = 'Enter your first and last name';
  if (!MATRIC_RE.test(f.matricNo.trim())) e.matricNo = 'Enter a valid matric number, e.g. CSC/2021/001';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email or leave it empty';
  if (f.department.trim().length < 2) e.department = 'Enter your department';
  if (f.password.length < 6) e.password = 'At least 6 characters';
  if (f.confirm !== f.password) e.confirm = 'Passwords do not match';
  return e;
}

export function RegisterScreen() {
  const navigation = useNavigation();
  const { registerStudent } = useAuth();
  const [form, setForm] = useState<Form>({
    fullName: '',
    matricNo: '',
    email: '',
    department: '',
    level: '100',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setError(null);
    setLoading(true);
    try {
      await registerStudent({
        full_name: form.fullName.trim(),
        matric_no: form.matricNo.trim(),
        email: form.email.trim() || null,
        department: form.department.trim(),
        level: form.level,
        password: form.password,
      });
      // AppNavigator now shows the face-enrolment flow
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="grow px-5 py-6" keyboardShouldPersistTaps="handled">
          <Text className="text-xs font-semibold uppercase tracking-wider text-accent">Step 1 of 2</Text>
          <Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">Create your account</Text>
          <Text className="mb-6 mt-1 text-sm text-muted">Your details first. Next you'll register your face.</Text>

          <Card className="p-5">
            <FormField label="Full name" value={form.fullName} onChangeText={set('fullName')} placeholder="e.g. Adebayo Oluwaseun" error={errors.fullName} autoCapitalize="words" />
            <FormField label="Matric number" value={form.matricNo} onChangeText={set('matricNo')} placeholder="e.g. CSC/2021/001" error={errors.matricNo} autoCapitalize="characters" autoCorrect={false} />
            <FormField label="Email (optional)" value={form.email} onChangeText={set('email')} placeholder="you@stu.ui.edu.ng" error={errors.email} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
            <FormField label="Department" value={form.department} onChangeText={set('department')} placeholder="e.g. Computer Science" error={errors.department} autoCapitalize="words" />

            <Label className="mb-2">Level</Label>
            <Tabs value={form.level} onValueChange={set('level')} className="mb-4">
              <Tabs.List className="w-full">
                <Tabs.Indicator />
                {LEVELS.map((l) => (
                  <Tabs.Trigger key={l} value={l} className="flex-1">
                    <Tabs.Label>{l}</Tabs.Label>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs>

            <FormField label="Password" value={form.password} onChangeText={set('password')} placeholder="At least 6 characters" secureTextEntry error={errors.password} />
            <FormField label="Confirm password" value={form.confirm} onChangeText={set('confirm')} placeholder="Repeat password" secureTextEntry error={errors.confirm} onSubmitEditing={submit} />

            {error ? (
              <Alert status="danger" className="mb-4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}

            <Button size="lg" onPress={submit} isDisabled={loading}>
              {loading ? <Spinner color="white" /> : 'Continue to face registration'}
            </Button>
          </Card>

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">Already registered?</Text>
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Log in
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
