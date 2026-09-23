import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/services/redis.service';
import { AuthConfig } from '../config/auth.config';
import { verifyBrowserBinding } from '../crypto';
import { isPendingLogin, PendingLogin } from './pending-login';

export class PendingLoginError extends Error {
  constructor() {
    super('Pending login unavailable or invalid');
  }
}

const TAKE_ONCE = `local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v`;

@Injectable()
export class PendingLoginStore {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AuthConfig,
  ) {}

  private key(state: string): string {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) throw new PendingLoginError();
    return `${this.config.redisKeyPrefix}:${this.config.environment}:pending:${state}`;
  }

  async create(state: string, pending: PendingLogin): Promise<void> {
    if (
      !isPendingLogin(pending) ||
      pending.clientId !== this.config.hubClientId ||
      pending.redirectUri !== this.config.callbackUrl
    )
      throw new PendingLoginError();
    const result = await this.redis.execute((client) =>
      client.set(
        this.key(state),
        JSON.stringify(pending),
        'EX',
        this.config.pendingTtlSeconds,
        'NX',
      ),
    );
    if (result !== 'OK') throw new PendingLoginError();
  }

  async take(state: string, browserBinding: string): Promise<PendingLogin> {
    const raw = await this.redis.execute((client) =>
      client.eval(TAKE_ONCE, 1, this.key(state)),
    );
    if (typeof raw !== 'string') throw new PendingLoginError();
    try {
      const pending: unknown = JSON.parse(raw);
      if (
        !isPendingLogin(pending) ||
        pending.clientId !== this.config.hubClientId ||
        pending.redirectUri !== this.config.callbackUrl ||
        Date.now() - pending.createdAt > this.config.pendingTtlSeconds * 1000 ||
        pending.createdAt > Date.now() ||
        !verifyBrowserBinding(browserBinding, pending.browserBindingHash)
      )
        throw new PendingLoginError();
      return pending;
    } catch {
      throw new PendingLoginError();
    }
  }
}
