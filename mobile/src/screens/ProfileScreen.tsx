/** Student profile: account details, face re-enrolment and logging out. */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar, Button, Card, ListGroup, Separator } from 'heroui-native';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon, PageHeader, Screen, SectionTitle, type IconName } from '@/components/ui';
import { useAuth, useStudent } from '@/context/AuthContext';
import type { RootStackParamList } from '@/navigation/types';

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const student = useStudent();
  const { logout } = useAuth();
  const initials = student.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const rows: [IconName, string, string][] = [
    ['card-outline', 'Matric number', student.matric_no],
    ['school-outline', 'Department', student.department],
    ['layers-outline', 'Level', `${student.level} Level`],
    ['mail-outline', 'Email', student.email ?? 'Not provided'],
  ];

  return (
    <Screen>
      <ScrollView contentContainerClassName="px-5 pb-10 pt-4">
        <PageHeader title="Profile" />

        <Card className="mb-2 items-center gap-2 py-6">
          <Avatar size="lg" alt={student.full_name}>
            <Avatar.Fallback>{initials}</Avatar.Fallback>
          </Avatar>
          <Text className="text-xl font-bold text-foreground">{student.full_name}</Text>
          <View className="flex-row items-center gap-1.5">
            <Icon name={student.face_enrolled ? 'checkmark-circle' : 'alert-circle'} size={16} color={student.face_enrolled ? 'success' : 'warning'} />
            <Text className="text-sm text-muted">{student.face_enrolled ? 'Face registered' : 'Face not registered'}</Text>
          </View>
        </Card>

        <SectionTitle>Account</SectionTitle>
        <ListGroup>
          {rows.map(([icon, label, value], i) => (
            <React.Fragment key={label}>
              {i > 0 ? <Separator className="mx-4" /> : null}
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  <Icon name={icon} size={20} color="accent" />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemDescription>{label}</ListGroup.ItemDescription>
                  <ListGroup.ItemTitle>{value}</ListGroup.ItemTitle>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            </React.Fragment>
          ))}
        </ListGroup>

        <SectionTitle>Face recognition</SectionTitle>
        <ListGroup>
          <ListGroup.Item onPress={() => navigation.navigate('EnrolFace')}>
            <ListGroup.ItemPrefix>
              <Icon name="scan-outline" size={20} color="accent" />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Re-enrol your face</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>Do this if you're not being recognised in class</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        </ListGroup>

        <Button variant="danger-soft" className="mt-8" onPress={() => void logout()}>
          <Icon name="log-out-outline" size={18} color="danger" />
          <Button.Label>Log out</Button.Label>
        </Button>
      </ScrollView>
    </Screen>
  );
}
