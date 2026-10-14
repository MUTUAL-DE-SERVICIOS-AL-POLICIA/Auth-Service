# Auth-Service

Microservicio de autenticación de MUSERPOL. Expone contratos NATS y mantiene separados tres dominios:

- autenticación web interna con sesión SID, OIDC, Token Exchange y autorización UMA;
- autenticación de App Mobile;
- firma y validación JWT RS256 para la integración BCB.

La autenticación web heredada basada en cookie `msp`, LDAP y JWT simétrico fue retirada. Este servicio ya no requiere una base de datos propia para autenticar usuarios web.

## Estructura

```text
src/
├── auth/             # SID/OIDC/UMA: configuración, contratos, sesión y cliente Keycloak
├── auth-app-mobile/  # flujo independiente de App Mobile
├── auth-bcb/         # JWT RS256 para BCB
├── common/           # NATS, Redis y filtros compartidos
├── config/           # validación de variables activas
├── app.module.ts
└── main.ts
```

## Configuración

Use `.env.compose.template` como referencia. Las variables se agrupan por responsabilidad:

- `NATS_SERVERS` para comunicación interna;
- `USER_TEST_DEVICE` y `USER_TEST_ACCESS` para App Mobile;
- `BCB_JWT_PRIVATE_KEY` y `BCB_JWT_PUBLIC_KEY` para BCB;
- `OIDC_*`, `WEB_CLIENT_CATALOG` y `WEB_REDIS_*` para autenticación web.

Los archivos `.env` reales no deben versionarse.

## Desarrollo

```bash
pnpm install
pnpm build
pnpm start:dev
```

Las integraciones web consumen los patrones declarados en `src/auth/contracts/auth.contracts.ts`. App Mobile y BCB conservan sus patrones propios y no comparten tokens con la sesión web.
