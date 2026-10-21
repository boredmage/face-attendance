/**
 * Photo -> face embedding, on the phone (no network).
 *
 *   1. ML Kit finds the face in the captured photo (the largest one).
 *   2. Square crop around it (crop.ts), resized to 160x160 by expo-image-manipulator.
 *   3. The crop is decoded to pixels and packed as BGR floats in 0..1.
 *   4. Facenet512 (TFLite, GPU delegate on Android when available) gives a 512-d vector, which is
 *      L2-normalised.
 *
 * Used by student enrolment (one embedding per pose) and by the lecturer's scanner. Both must use
 * exactly this code so their embeddings are comparable.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Platform } from 'react-native';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import { detectFaces } from 'react-native-vision-camera-face-detector';

import { discardFiles } from '@/utils/files';

import { EMBEDDING_SIZE, INPUT_SIZE } from './config';
import { squareCrop, type Box } from './crop';
import { base64ToBytes, l2Normalise } from './matcher';

export class NoFaceError extends Error {
  constructor() {
    super('No face found. Come closer, face the camera and try again.');
  }
}

let modelPromise: Promise<TfliteModel> | null = null;

/** Load the model once (a ~47 MB asset); later calls reuse it. Call early to hide the load time. */
export function loadFaceModel(): Promise<TfliteModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const source = require('../../assets/models/facenet512.tflite');
      if (Platform.OS === 'android') {
        try {
          return await loadTensorflowModel(source, ['android-gpu']);
        } catch (err) {
          console.warn('TFLite GPU delegate unavailable, using CPU', err);
        }
      }
      return loadTensorflowModel(source, []);
    })().catch((err) => {
      modelPromise = null; // allow a retry
      throw err;
    });
  }
  return modelPromise;
}

export interface Photo {
  uri: string;
  width: number;
  height: number;
}

export interface FaceEmbedding {
  vector: Float32Array; // L2-normalised, EMBEDDING_SIZE long
  box: Box;
  millis: number;
}

async function largestFace(uri: string): Promise<Box> {
  const faces = await detectFaces({
    image: uri,
    options: { performanceMode: 'accurate', landmarkMode: 'none', classificationMode: 'none', minFaceSize: 0.15 },
  });
  if (!faces?.length) throw new NoFaceError();
  const best = faces.reduce((a, b) => (b.bounds.width * b.bounds.height > a.bounds.width * a.bounds.height ? b : a));
  return best.bounds;
}

/** 160x160 face crop as the model's input tensor (BGR, 0..1). */
async function faceTensor(photo: Photo, box: Box): Promise<Float32Array> {
  const { x, y, side } = squareCrop(photo.width, photo.height, box);
  const crop = await ImageManipulator.manipulateAsync(
    photo.uri,
    [{ crop: { originX: x, originY: y, width: side, height: side } }, { resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  discardFiles(crop.uri); // only the base64 copy is needed
  const decoded = jpeg.decode(base64ToBytes(crop.base64 ?? ''), { useTArray: true, formatAsRGBA: true });
  if (decoded.width !== INPUT_SIZE || decoded.height !== INPUT_SIZE) {
    throw new Error(`Unexpected crop size ${decoded.width}x${decoded.height}`);
  }
  const rgba = decoded.data;
  const out = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let p = 0, o = 0; p < rgba.length; p += 4, o += 3) {
    out[o] = rgba[p + 2] / 255; // B
    out[o + 1] = rgba[p + 1] / 255; // G
    out[o + 2] = rgba[p] / 255; // R
  }
  return out;
}

export async function embedPhoto(photo: Photo): Promise<FaceEmbedding> {
  const started = Date.now();
  const [model, box] = await Promise.all([loadFaceModel(), largestFace(photo.uri)]);
  const input = await faceTensor(photo, box);
  const [output] = await model.run([input.buffer as ArrayBuffer]);
  const raw = new Float32Array(output);
  if (raw.length !== EMBEDDING_SIZE) throw new Error(`Model returned ${raw.length} values, expected ${EMBEDDING_SIZE}`);
  return { vector: l2Normalise(raw), box, millis: Date.now() - started };
}
