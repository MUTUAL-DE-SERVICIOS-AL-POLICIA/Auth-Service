import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PvtImportAuthConfig } from '../config/pvt-import-auth.config';
import { PvtImportAuthConfigToken } from '../config/auth.tokens';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

interface UserInfoResponse {
  sub?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class PvtImportAuthService {
  private readonly logger = new Logger(PvtImportAuthService.name);

  constructor(
    @Inject(PvtImportAuthConfigToken)
    private readonly config: PvtImportAuthConfig,
  ) {}

  async validateCredentials(username: string, password: string) {
    if (!username?.trim() || !password) throw this.invalidCredentials();

    const token = await this.requestToken(username.trim(), password);
    try {
      const userInfo = await this.requestUserInfo(token.access_token!);
      const resolvedUsername = userInfo.preferred_username || userInfo.sub;
      if (!resolvedUsername) {
        this.logger.error('Keycloak userinfo did not return a user identifier');
        throw this.unavailable();
      }
      const fullName =
        userInfo.name?.trim() ||
        [userInfo.given_name, userInfo.family_name]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        resolvedUsername;
      return {
        user: { username: resolvedUsername, name: fullName },
        access: [],
      };
    } finally {
      if (token.refresh_token)
        await this.closeDirectGrantSession(token.refresh_token);
    }
  }

  private async requestToken(
    username: string,
    password: string,
  ): Promise<Required<Pick<TokenResponse, 'access_token'>> & TokenResponse> {
    let response: Response;
    try {
      response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          username,
          password,
          scope: 'openid profile',
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      this.logger.error(
        'Unable to reach Keycloak for PVT credential validation',
        error,
      );
      throw this.unavailable();
    }

    const payload = (await this.safeJson(response)) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      if (payload.error === 'invalid_grant') throw this.invalidCredentials();
      this.logger.error(
        `Keycloak rejected the PVT import client request (${payload.error || response.status})`,
      );
      throw this.unavailable();
    }
    return payload as Required<Pick<TokenResponse, 'access_token'>> &
      TokenResponse;
  }

  private async requestUserInfo(
    accessToken: string,
  ): Promise<UserInfoResponse> {
    let response: Response;
    try {
      response = await fetch(this.config.userInfoUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      this.logger.error(
        'Unable to obtain the authenticated PVT user from Keycloak',
        error,
      );
      throw this.unavailable();
    }
    if (!response.ok) {
      this.logger.error(
        `Keycloak userinfo request failed (${response.status})`,
      );
      throw this.unavailable();
    }
    return (await this.safeJson(response)) as UserInfoResponse;
  }

  private async closeDirectGrantSession(refreshToken: string): Promise<void> {
    try {
      const response = await fetch(this.config.logoutUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) {
        this.logger.warn(
          `Could not close the PVT Direct Grant session (${response.status})`,
        );
      }
    } catch (error) {
      this.logger.warn('Could not close the PVT Direct Grant session', error);
    }
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private invalidCredentials(): RpcException {
    return new RpcException({
      message: 'Invalid credentials',
      statusCode: 401,
    });
  }

  private unavailable(): RpcException {
    return new RpcException({
      message: 'Credential validation service unavailable',
      statusCode: 503,
    });
  }
}
