/**
 * Background sync for the lecturer's phone (Android WorkManager / iOS BGTaskScheduler via
 * expo-background-task). The OS decides when it runs, at most every ~15 minutes.
 *
 * `defineTask` must run at module load, so App.tsx imports this file at the top level.
 */
import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { REFRESH_KEY } from '@/api/client';

import { syncManager } from './syncManager';

const TASK = 'attendance-sync';

TaskManager.defineTask(TASK, async () => {
  try {
    if (!(await SecureStore.getItemAsync(REFRESH_KEY))) return BackgroundTask.BackgroundTaskResult.Success;
    await syncManager.syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }
  } catch (err) {
    console.warn('Background sync unavailable', err);
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
  } catch {
    // not registered
  }
}
