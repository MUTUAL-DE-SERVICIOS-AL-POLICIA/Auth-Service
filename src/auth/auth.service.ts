import { BadRequestException, Injectable } from '@nestjs/common';
import { PendingStore } from 'src/session/pending/pending.store';
import { SessionStore } from 'src/session/store/session.store';
import { ClientTokenSet, SessionData } from 'src/session/session.types';
import {
  ensureClientAllowed,
  resolveClientIdOrThrow,
  deriveHubRedirectUri,
  ensureReturnToAllowed,
} from './utils/helpers/clients';
import { generatePkce } from './utils/helpers/pkce';
import { randomId } from './utils/helpers/crypto';
import { KeycloakService } from 'src/keycloak/keycloak.service';
import { peekRoles, peekSub, peekUserProfile } from './utils/helpers/jwt-peek';
import { getOrigins, getSecret, hubClientId } from '../config/oidc-client';
import {
  ExchangeCodeDto,
  ExchangeCodeResDto,
  LoginStartDto,
  LogoutDto,
  LoginStartResDto,
  GetProfileDto,
  GetProfileRes,
  VerifyTokenDto,
  VerifyTokenRes,
  GetPermissionsDto,
  GetPermissionsRes,
  EvaluatePermissionDto,
  EvaluatePermissionRes,
  TokenExchangeDto,
  TokenExchangeRes,
} from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly keycloak: KeycloakService,
    private readonly pending: PendingStore,
    private readonly sessions: SessionStore,
  ) {}

  private async ensureSecondaryClientViaTokenExchange(
    sid: string,
    clientId: string,
  ): Promise<ClientTokenSet> {
    const requesterClientId = hubClientId;
    const targetClientId = clientId;

    const session = await this.sessions.get(sid);
    if (!session) {
      throw new BadRequestException('Sesión inválida o expirada');
    }

    const hubTokenSet = await this.ensureFreshClientToken(
      sid,
      requesterClientId,
    );

    const requesterClientSecret = getSecret(requesterClientId);

    const data = await this.keycloak.tokenExchangeRequest(
      hubTokenSet.accessToken,
      requesterClientId,
      requesterClientSecret,
      targetClientId,
    );

    const now = Math.floor(Date.now() / 1000);
    const nextTokenSet: ClientTokenSet = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: now + Number(data.expires_in ?? 300),
      roles: peekRoles(data.access_token, targetClientId),
    };

    session.clients[targetClientId] = nextTokenSet;
    await this.sessions.set(sid, session);

    return nextTokenSet;
  }
  private async ensureFreshClientToken(
    sessionId: string,
    clientId: string,
  ): Promise<ClientTokenSet> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new BadRequestException('Sesión inválida o expirada');
    }

    const tokenSet = session.clients?.[clientId];
    if (!tokenSet?.accessToken) {
      throw new BadRequestException(
        `No existe token para el cliente ${clientId} en la sesión`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const safetyWindowSec = 30;

    console.log('[ensureFreshClientToken] clientId:', clientId);
    console.log(
      '[ensureFreshClientToken] expiresAt:',
      tokenSet.expiresAt,
      'now:',
      now,
    );

    // Si todavía está vigente, lo reutilizamos
    if (tokenSet.expiresAt > now + safetyWindowSec) {
      return tokenSet;
    }

    // Si no hay refresh token, limpiamos el cliente de la sesión
    if (!tokenSet.refreshToken) {
      delete session.clients[clientId];

      if (!Object.keys(session.clients ?? {}).length) {
        await this.sessions.del(sessionId);
      } else {
        await this.sessions.set(sessionId, session);
      }

      throw new BadRequestException(
        `El token del cliente ${clientId} expiró y no existe refresh token`,
      );
    }

    console.log(
      '[ensureFreshClientToken] token expirado o por expirar, refrescando...',
    );

    try {
      const clientSecret = getSecret(clientId);

      const refreshed = await this.keycloak.refreshTokenRequest(
        clientId,
        tokenSet.refreshToken,
        clientSecret,
      );

      const nextTokenSet: ClientTokenSet = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? tokenSet.refreshToken,
        idToken: refreshed.id_token ?? tokenSet.idToken,
        expiresAt: now + Number(refreshed.expires_in ?? 300),
        roles: peekRoles(refreshed.access_token, clientId),
      };

      session.clients[clientId] = nextTokenSet;
      await this.sessions.set(sessionId, session);

      console.log('[ensureFreshClientToken] refresh exitoso');

      return nextTokenSet;
    } catch (error) {
      console.warn(
        `[ensureFreshClientToken] refresh falló para ${clientId}, limpiando sesión del cliente`,
      );

      delete session.clients[clientId];

      if (!Object.keys(session.clients ?? {}).length) {
        await this.sessions.del(sessionId);
        console.warn(
          `[ensureFreshClientToken] no quedan clientes en la sesión ${sessionId}, sesión eliminada`,
        );
      } else {
        await this.sessions.set(sessionId, session);
        console.warn(
          `[ensureFreshClientToken] cliente ${clientId} eliminado de la sesión ${sessionId}`,
        );
      }

      throw new BadRequestException(
        `No se pudo refrescar el token del cliente ${clientId}`,
      );
    }
  }

  async loginStartHandler({
    clientId,
    returnTo,
  }: LoginStartDto): Promise<LoginStartResDto> {
    ensureClientAllowed(clientId);

    if (clientId !== hubClientId) {
      throw new BadRequestException(
        `El flujo de login browser solo está permitido para el cliente ${hubClientId}`,
      );
    }

    ensureReturnToAllowed(returnTo);

    const hubOrigin = getOrigins(hubClientId)[0];
    if (!hubOrigin) {
      throw new BadRequestException(
        `No se encontró origin configurado para el cliente hub ${hubClientId}`,
      );
    }

    const redirectUri = deriveHubRedirectUri(hubOrigin);

    const { verifier, challenge, method } = generatePkce();
    const state = randomId(32);

    await this.pending.set(state, {
      codeVerifier: verifier,
      clientId,
      redirectUri,
      returnTo,
      createdAt: Date.now(),
    });

    const authUrl = this.keycloak.authorizeUrl({
      clientId,
      redirectUri,
      state,
      pkce: { challenge, method },
    });

    return { ok: true, url: authUrl, state };
  }

  async exchangeCode({
    code,
    state,
    sid,
  }: ExchangeCodeDto): Promise<ExchangeCodeResDto> {
    const stash = await this.pending.take(state);
    if (!stash) throw new BadRequestException('State no encontrado o expirado');

    const { clientId, codeVerifier, redirectUri, returnTo } = stash;
    ensureClientAllowed(clientId);

    const clientSecret = getSecret(clientId);

    const data = await this.keycloak.tokenRequest(
      clientId,
      clientSecret,
      code,
      codeVerifier,
      redirectUri,
    );

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Number(data.expires_in ?? 300);
    const sub = peekSub(data.access_token);
    const roles = peekRoles(data.access_token, clientId);

    const sessionId = sid ?? randomId();

    const existing =
      (await this.sessions.get(sessionId)) ??
      ({
        tokenType: data.token_type ?? 'Bearer',
        sub,
        clients: {},
      } as SessionData);

    existing.tokenType = data.token_type ?? existing.tokenType ?? 'Bearer';
    existing.sub = existing.sub ?? sub;
    existing.clients[clientId] = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt,
      roles,
    };

    await this.sessions.set(sessionId, existing);

    const profile = peekUserProfile(data.access_token);

    console.log('Access Token: ', data.access_token);
    console.log('Refresh Token: ', data.refresh_token);
    return {
      ok: true,
      sid: sessionId,
      returnTo,
      profile: {
        sub: sub ?? '',
        username: profile?.username ?? profile?.preferred_username,
        name: profile?.name,
        givenName: profile?.given_name,
        familyName: profile?.family_name,
        email: profile?.email,
        roles,
      },
    };
  }

  async logout({ sid }: LogoutDto) {
    const session = await this.sessions.get(sid);
    if (!session) return;

    const entries = Object.entries(session.clients ?? {});

    for (const [clientId, clientSet] of entries) {
      const refresh = clientSet.refreshToken;
      if (!refresh) continue;

      try {
        const secret = getSecret(clientId);
        await this.keycloak.logoutRequest(refresh, { id: clientId, secret });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Logout failed for ${clientId}: ${message}`);
      }
    }

    await this.sessions.del(sid);
  }

  async getProfileByCtx(dto: GetProfileDto): Promise<GetProfileRes> {
    const session = await this.sessions.get(dto.sid);
    if (!session) throw new BadRequestException('Sesión inválida o expirada');

    const { clientId } = resolveClientIdOrThrow({
      clientId: dto.clientId,
      origin: dto.origin,
    });

    const set = await this.ensureFreshClientToken(dto.sid, clientId);
    await this.sessions.touch(dto.sid);

    const profile = peekUserProfile(set.accessToken);
    const roles = set.roles ?? peekRoles(set.accessToken, clientId) ?? [];
    const sub = session.sub ?? profile?.sub ?? peekSub(set.accessToken);

    return {
      ok: true,
      clientId,
      sub: sub || '',
      username: profile?.username ?? profile?.preferred_username,
      name: profile?.name,
      givenName: profile?.given_name,
      familyName: profile?.family_name,
      email: profile?.email,
      roles,
    };
  }

  // async verifyToken(dto: VerifyTokenDto): Promise<VerifyTokenRes> {
  //   const session = await this.sessions.get(dto.sid);
  //   if (!session) throw new BadRequestException('Sesión inválida o expirada');

  //   const { clientId } = resolveClientIdOrThrow({
  //     clientId: dto.clientId,
  //     origin: dto.origin,
  //   });

  //   const set = await this.ensureFreshClientToken(dto.sid, clientId);
  //   await this.sessions.touch(dto.sid);

  //   try {
  //     const checkAzp = dto.checkAzp ?? true;
  //     const clockSkew = dto.clockSkewSec ?? 90;

  //     await this.keycloak.verifyAccessToken(set.accessToken, {
  //       azp: checkAzp ? clientId : undefined,
  //       clockSkewSec: clockSkew,
  //     });

  //     return { ok: true, exists: true, isValid: true };
  //   } catch (error) {
  //     const message = error instanceof Error ? error.message : String(error);
  //     console.warn(`Token verification failed: ${message}`);
  //     return { ok: true, exists: true, isValid: false };
  //   }
  // }
  // async verifyToken(dto: VerifyTokenDto): Promise<VerifyTokenRes> {
  //   const session = await this.sessions.get(dto.sid);
  //   if (!session) throw new BadRequestException('Sesión inválida o expirada');

  //   const { clientId } = resolveClientIdOrThrow({
  //     clientId: dto.clientId,
  //     origin: dto.origin,
  //   });

  //   const set = await this.ensureFreshClientToken(dto.sid, clientId);
  //   await this.sessions.touch(dto.sid);

  //   try {
  //     const clockSkew = dto.clockSkewSec ?? 90;
  //     const isHubClient = clientId === hubClientId;

  //     await this.keycloak.verifyAccessToken(set.accessToken, {
  //       azp: isHubClient ? clientId : undefined,
  //       aud: !isHubClient ? clientId : undefined,
  //       clockSkewSec: clockSkew,
  //     });

  //     return { ok: true, exists: true, isValid: true };
  //   } catch (error) {
  //     const message = error instanceof Error ? error.message : String(error);
  //     console.warn(`Token verification failed: ${message}`);
  //     return { ok: true, exists: true, isValid: false };
  //   }
  // }
  async verifyToken(dto: VerifyTokenDto): Promise<VerifyTokenRes> {
    const session = await this.sessions.get(dto.sid);
    if (!session) {
      return { ok: true, exists: false, isValid: false };
    }

    const { clientId } = resolveClientIdOrThrow({
      clientId: dto.clientId,
      origin: dto.origin,
    });

    const clockSkew = dto.clockSkewSec ?? 90;
    const isHubClient = clientId === hubClientId;

    const verifyCurrentToken = async () => {
      const set = await this.ensureFreshClientToken(dto.sid, clientId);

      await this.keycloak.verifyAccessToken(set.accessToken, {
        azp: isHubClient ? clientId : undefined,
        aud: !isHubClient ? clientId : undefined,
        clockSkewSec: clockSkew,
      });

      await this.sessions.touch(dto.sid);
      return { ok: true, exists: true, isValid: true } as VerifyTokenRes;
    };

    try {
      return await verifyCurrentToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Token verification failed for ${clientId}: ${message}`);

      // Si no es el hub, intentamos recomponer el cliente secundario
      if (!isHubClient) {
        try {
          await this.ensureSecondaryClientViaTokenExchange(dto.sid, clientId);
          return await verifyCurrentToken();
        } catch (exchangeError) {
          const exchangeMessage =
            exchangeError instanceof Error
              ? exchangeError.message
              : String(exchangeError);

          console.warn(
            `Token exchange fallback failed for ${clientId}: ${exchangeMessage}`,
          );
        }
      }

      // Si llegamos aquí, no se pudo recuperar
      const stillExists = !!(await this.sessions.get(dto.sid));
      return {
        ok: true,
        exists: stillExists,
        isValid: false,
      };
    }
  }
  async getPermissions(dto: GetPermissionsDto): Promise<GetPermissionsRes> {
    const session = await this.sessions.get(dto.sid);
    if (!session) throw new BadRequestException('Sesión inválida o expirada');

    const { clientId } = resolveClientIdOrThrow({
      clientId: dto.clientId,
      origin: dto.origin,
    });

    const set = await this.ensureFreshClientToken(dto.sid, clientId);
    await this.sessions.touch(dto.sid);

    const data = await this.keycloak.umaRequest({
      accessToken: set.accessToken,
      audience: dto.audience,
      responseMode: 'permissions',
    });

    return {
      ok: true,
      audience: dto.audience,
      permissions: data,
    };
  }

  async evaluatePermission(
    dto: EvaluatePermissionDto,
  ): Promise<EvaluatePermissionRes> {
    const { sid, audience, scope } = dto;

    const resource = dto.subResource
      ? `${dto.resource}.${dto.subResource}`
      : dto.resource;

    const session = await this.sessions.get(dto.sid);
    if (!session) throw new BadRequestException('Sesión inválida o expirada');

    const { clientId } = resolveClientIdOrThrow({
      clientId: dto.clientId,
      origin: dto.origin,
    });

    const set = await this.ensureFreshClientToken(dto.sid, clientId);
    await this.sessions.touch(dto.sid);

    let raw: any;
    let granted = false;

    try {
      raw = await this.keycloak.umaRequest({
        accessToken: set.accessToken,
        audience,
        responseMode: 'decision',
        permission: `${resource}#${scope}`,
      });

      console.log('UMA raw response:', raw);
      granted = !!raw?.result;
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;

      if (status === 403 || status === 401) {
        console.log('UMA denied permission (expected):', {
          status,
          sid,
          clientId,
          audience,
          resource,
          scope,
        });
        granted = false;
      } else {
        console.error('UMA unexpected error:', err);
        throw err;
      }
    }

    return {
      ok: true,
      audience,
      resource,
      scope,
      granted,
    };
  }

  async tokenExchange(dto: TokenExchangeDto): Promise<TokenExchangeRes> {
    const { sid, audience } = dto;

    // El requester del token exchange siempre es el hub
    const requesterClientId = hubClientId;

    // El cliente destino real es el audience
    const targetClientId = audience;

    console.log('Token exchange request:', {
      sid,
      requesterClientId,
      targetClientId,
    });

    const session = await this.sessions.get(sid);
    if (!session) {
      throw new BadRequestException('Sesión inválida o expirada');
    }

    // Aseguramos que el token del hub esté fresco
    const hubTokenSet = await this.ensureFreshClientToken(
      sid,
      requesterClientId,
    );

    // Si aún no existe contexto para el cliente destino, hacemos token exchange
    if (!session.clients?.[targetClientId]?.accessToken) {
      ensureClientAllowed(requesterClientId);

      const requesterClientSecret = getSecret(requesterClientId);

      const data = await this.keycloak.tokenExchangeRequest(
        hubTokenSet.accessToken,
        requesterClientId,
        requesterClientSecret,
        targetClientId,
      );

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + Number(data.expires_in ?? 300);
      const roles = peekRoles(data.access_token, targetClientId);

      session.clients[targetClientId] = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        expiresAt,
        roles,
      };

      await this.sessions.set(sid, session);
    }

    // A partir de aquí trabajamos con el cliente destino, no con el hub
    const set = await this.ensureFreshClientToken(sid, targetClientId);
    await this.sessions.touch(sid);

    const profile = peekUserProfile(set.accessToken);
    const roles = set.roles ?? peekRoles(set.accessToken, targetClientId) ?? [];
    const sub = session.sub ?? peekSub(set.accessToken);

    return {
      ok: true,
      profile: {
        sub: sub ?? '',
        username: profile?.username ?? profile?.preferred_username,
        name: profile?.name,
        givenName: profile?.given_name,
        familyName: profile?.family_name,
        email: profile?.email,
        roles,
      },
    };
  }
}
