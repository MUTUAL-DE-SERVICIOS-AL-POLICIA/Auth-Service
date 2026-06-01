import { BadRequestException } from '@nestjs/common';
import { getClient, allOrigins } from '../../../config/oidc-client';
import { originOf } from './origins';

/** Lanza si el clientId no existe en OIDC_CLIENTS */
export function ensureClientAllowed(clientId: string) {
  const c = getClient(clientId);
  if (!clientId || !c) {
    throw new Error(`client_id no permitido: ${clientId}`);
  }
}

/**
 * Valida que el returnTo pertenezca a algún frontend conocido de la plataforma.
 * Ya no se valida contra el clientId del login.
 */
export function ensureReturnToAllowed(returnTo: string) {
  const origin = originOf(returnTo);
  const allowed = allOrigins();

  if (!allowed.includes(origin)) {
    throw new Error(
      `returnTo no permitido. Recibido: ${origin}. Permitidos: [${allowed.join(', ')}]`,
    );
  }
}

/**
 * El redirectUri del flujo Authorization Code siempre será el callback del hub.
 */
export function deriveHubRedirectUri(hubOrigin: string) {
  return `${hubOrigin}/api/auth/callback`;
}

export function findClientIdByOrigin(origin: string): string | undefined {
  const dict = Object.entries(
    require('../../../config/envs').OidcClientsDict as Record<
      string,
      { origins?: string[] }
    >,
  );

  for (const [cid, cfg] of dict) {
    if ((cfg.origins ?? []).includes(origin)) return cid;
  }

  return undefined;
}

/** Devuelve { clientId, origin? } o lanza si no puede resolver */
export function resolveClientIdOrThrow(ctx: {
  clientId?: string;
  origin?: string;
  referer?: string;
}) {
  if (ctx.clientId) {
    const exists = !!getClient(ctx.clientId);
    if (!exists)
      throw new BadRequestException(`client_id no permitido: ${ctx.clientId}`);
    return { clientId: ctx.clientId, origin: ctx.origin };
  }

  const origin = ctx.origin || (ctx.referer ? originOf(ctx.referer) : undefined);

  if (!origin) {
    throw new BadRequestException(
      'No se pudo resolver el client_id (falta clientId/origin/referer)',
    );
  }

  const cid = findClientIdByOrigin(origin);
  if (!cid)
    throw new BadRequestException(
      `No se encontró client_id para el origin: ${origin}`,
    );

  return { clientId: cid, origin };
}

