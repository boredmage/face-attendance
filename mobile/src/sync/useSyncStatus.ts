import { useEffect, useState } from 'react';

import { syncManager, type SyncStatus } from './syncManager';

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(syncManager.getStatus());
  useEffect(() => syncManager.subscribe(setStatus), []);
  return status;
}
