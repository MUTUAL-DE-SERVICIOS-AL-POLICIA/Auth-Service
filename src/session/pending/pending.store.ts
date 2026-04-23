import { PendingData } from '../session.types';

export abstract class PendingStore {
  abstract set(state: string, data: PendingData, ttlMs?: number): Promise<void>;
  abstract take(state: string): Promise<PendingData | undefined>;
  abstract gc(ttlMs?: number): Promise<void>;
}