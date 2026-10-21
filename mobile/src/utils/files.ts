import { File } from 'expo-file-system';

/**
 * Delete temporary files (face photos and crops) once they have been used. Best effort: a file
 * that is already gone or cannot be removed is ignored, so cleanup never breaks a scan.
 */
export function discardFiles(...uris: (string | null | undefined)[]): void {
  for (const uri of uris) {
    if (!uri) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (err) {
      console.warn('Could not delete temporary file', uri, err);
    }
  }
}
