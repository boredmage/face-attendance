/**
 * Step 2 of registration: explains why the face is needed before the (mandatory) enrolment.
 * Until it is done the student can't reach the rest of the app, only log out.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ListGroup, Separator } from 'heroui-native';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon, Screen, type IconName } from '@/components/ui';
import { useAuth, useStudent } from '@/context/AuthContext';
import type { FaceSetupStackParamList } from '@/navigation/types';

const TIPS: [IconName, string, string][] = [
  ['sunny-outline', 'Good lighting', 'Face a light source; avoid bright windows behind you.'],
  ['glasses-outline', 'Nothing covering your face', 'Remove caps, sunglasses and face masks.'],
  ['sync-outline', 'Move slowly', "Look straight, then turn left, right, up and down."],
  ['person-outline', 'Only you', 'Each face can only belong to one account.'],
];

export function FaceIntroScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<FaceSetupStackParamList>>();
  const student = useStudent();
  const { logout } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerClassName="px-5 py-6">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent">Step 2 of 2</Text>
        <Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">Register your face</Text>
        <Text className="mb-6 mt-2 text-base text-muted">
          Welcome, {student.full_name.split(' ')[0]}. Your lecturer takes attendance by scanning faces on their phone, so
          we need a few photos of you first. It takes about 20 seconds and you only do it once.
        </Text>

        <Card className="mb-6 items-center py-8">
          <View className="size-24 items-center justify-center rounded-full bg-accent/10">
            <Icon name="scan-outline" size={48} color="accent" />
          </View>
        </Card>

        <ListGroup className="mb-6">
          {TIPS.map(([icon, title, text], i) => (
            <React.Fragment key={title}>
              {i > 0 ? <Separator className="mx-4" /> : null}
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  <Icon name={icon} size={22} color="accent" />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{text}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            </React.Fragment>
          ))}
        </ListGroup>

        <Button size="lg" onPress={() => navigation.navigate('EnrolFace')}>
          Start face registration
        </Button>
        <Button variant="ghost" className="mt-2" onPress={() => void logout()}>
          Log out
        </Button>
        <Text className="mt-3 text-center text-xs text-muted">You can't join courses until your face is registered.</Text>
      </ScrollView>
    </Screen>
  );
}
