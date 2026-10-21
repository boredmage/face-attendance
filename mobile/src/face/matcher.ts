/**
 * 1:N face search against a course's enrolled students, entirely on the phone.
 *
 * Every stored pose embedding is packed into one Float32Array (all rows L2-normalised), so a
 * search is one pass of dot products: 1,000 students x 5 poses x 512 floats is ~2.5M multiply-adds,
 * a few milliseconds. The decision rule matches the server's `face_service.identify`: the closest
 * student must be within `threshold` (cosine distance) AND beat the runner-up by `margin`, so two
 * look-alikes are never confused silently.
 */
import { EMBEDDING_SIZE } from './config';

export interface Candidate {
  studentId: number;
  /** poses x EMBEDDING_SIZE floats, each row L2-normalised */
  poses: Float32Array;
}

export interface Match {
  /** null = nobody close enough, or too close a call between two students */
  studentId: number | null;
  /** Best candidate (even when not accepted), for logs and "not recognised" diagnostics */
  bestStudentId: number | null;
  distance: number | null;
  runnerUp: number | null;
  confidence: number;
}

export function l2Normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) + 1e-9;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export class FaceIndex {
  private readonly rows: Float32Array;
  private readonly owners: Int32Array;
  readonly size: number;
  readonly students: number;

  constructor(candidates: Candidate[]) {
    const total = candidates.reduce((n, c) => n + Math.floor(c.poses.length / EMBEDDING_SIZE), 0);
    this.rows = new Float32Array(total * EMBEDDING_SIZE);
    this.owners = new Int32Array(total);
    let r = 0;
    for (const c of candidates) {
      const n = Math.floor(c.poses.length / EMBEDDING_SIZE);
      this.rows.set(c.poses.subarray(0, n * EMBEDDING_SIZE), r * EMBEDDING_SIZE);
      this.owners.fill(c.studentId, r, r + n);
      r += n;
    }
    this.size = total;
    this.students = new Set(candidates.filter((c) => c.poses.length >= EMBEDDING_SIZE).map((c) => c.studentId)).size;
  }

  /** `embedding` must be L2-normalised. */
  identify(embedding: Float32Array, threshold: number, margin: number): Match {
    const best = new Map<number, number>(); // student -> smallest distance over their poses
    for (let r = 0; r < this.size; r++) {
      const off = r * EMBEDDING_SIZE;
      let dot = 0;
      for (let i = 0; i < EMBEDDING_SIZE; i++) dot += embedding[i] * this.rows[off + i];
      const d = 1 - dot;
      const owner = this.owners[r];
      const prev = best.get(owner);
      if (prev === undefined || d < prev) best.set(owner, d);
    }
    let first: [number, number] | null = null;
    let second: number | null = null;
    for (const [id, d] of best) {
      if (!first || d < first[1]) {
        if (first) second = second === null ? first[1] : Math.min(second, first[1]);
        first = [id, d];
      } else if (second === null || d < second) {
        second = d;
      }
    }
    if (!first) return { studentId: null, bestStudentId: null, distance: null, runnerUp: null, confidence: 0 };
    const [id, distance] = first;
    const clear = second === null || second - distance >= margin;
    const accepted = distance <= threshold && clear;
    return {
      studentId: accepted ? id : null,
      bestStudentId: id,
      distance,
      runnerUp: second,
      confidence: Math.max(0, Math.min(1, 1 - distance)),
    };
  }
}

/** Decode the server's base64 little-endian float32 blob (see SyncFace in the backend). */
export function decodeEmbeddings(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  // Copy into an aligned buffer; Float32Array views need 4-byte alignment
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new Float32Array(buf);
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
