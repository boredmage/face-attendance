import { CROP_SCALE } from './config';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The square crop for a face box, shifted (never padded) to stay inside the image and shrunk if
 * the image is smaller. Same rule as `square_crop` in backend/app/face_tflite.py.
 */
export function squareCrop(imageWidth: number, imageHeight: number, box: Box): { x: number; y: number; side: number } {
  let side = Math.round(Math.max(box.width, box.height) * CROP_SCALE);
  side = Math.max(1, Math.min(side, imageWidth, imageHeight));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = Math.round(Math.min(Math.max(cx - side / 2, 0), imageWidth - side));
  const y = Math.round(Math.min(Math.max(cy - side / 2, 0), imageHeight - side));
  return { x, y, side };
}
