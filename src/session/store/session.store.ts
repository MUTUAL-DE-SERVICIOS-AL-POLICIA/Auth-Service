import { SessionData } from '../session.types';

export abstract class SessionStore {
  abstract get(sid: string): Promise<SessionData | undefined>;
  abstract set(sid: string, data: SessionData, ttlMs?: number): Promise<void>;
  abstract del(sid: string): Promise<void>;
  abstract touch(sid: string, ttlMs?: number): Promise<void>;
  abstract gc(): Promise<void>;
}