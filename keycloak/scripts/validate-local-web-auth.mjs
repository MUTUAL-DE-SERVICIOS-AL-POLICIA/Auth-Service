#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const launcherRootUrl = new URL('../../../', import.meta.url);
const launcherRoot = fileURLToPath(launcherRootUrl);

async function loadEnvironment(relativePath) {
  const content = await readFile(
    new URL(relativePath, launcherRootUrl),
    'utf8',
  );
  const values = {};
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      value[0] === value.at(-1) &&
      ['"', "'"].includes(value[0])
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function required(values, key, source) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`${key} is required in ${source}`);
  return value;
}

function originWithPort(origin, port) {
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('AUTH_PUBLIC_ORIGIN must not contain a port or path');
  }
  url.port = port;
  return url.origin;
}

async function main() {
  const root = await loadEnvironment('.env');
  const auth = await loadEnvironment('Auth-Service/.env.compose');

  const publicOrigin = required(
    auth,
    'AUTH_PUBLIC_ORIGIN',
    'Auth-Service/.env.compose',
  );
  const keycloakOrigin = originWithPort(
    publicOrigin,
    required(root, 'KEYCLOAK_PORT', '.env'),
  );
  const hubOrigin = originWithPort(publicOrigin, auth.AUTH_HUB_PORT || '3001');
  const callbackPath = auth.CALLBACK_PATH || '/api/auth/callback';
  const callback = new URL(callbackPath, `${hubOrigin}/`);
  const gatewayPort = required(root, 'CLIENT_GATEWAY_PORT', '.env');
  const gatewayHost = callback.hostname.includes(':')
    ? `[${callback.hostname}]`
    : callback.hostname;
  const backchannel = new URL(
    `/api/auth/backchannel-logout`,
    `${callback.protocol}//${gatewayHost}:${gatewayPort}`,
  );

  const validationEnvironment = {
    ...process.env,
    KEYCLOAK_ADMIN_URL: (auth.KC_HOSTNAME || keycloakOrigin).replace(/\/$/u, ''),
    KEYCLOAK_ADMIN_REALM: 'master',
    KEYCLOAK_ADMIN_USERNAME: required(
      auth,
      'KC_BOOTSTRAP_ADMIN_USER',
      'Auth-Service/.env.compose',
    ),
    KEYCLOAK_ADMIN_PASSWORD: required(
      auth,
      'KC_BOOTSTRAP_ADMIN_PASSWORD',
      'Auth-Service/.env.compose',
    ),
    EXPECTED_HUB_CALLBACK_URL: callback.toString(),
    EXPECTED_HUB_POST_LOGOUT_URL: `${hubOrigin}/`,
    KEYCLOAK_BACKCHANNEL_LOGOUT_URL: backchannel.toString(),
  };

  const validator = fileURLToPath(
    new URL('./validate-web-auth.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [validator], {
    cwd: launcherRoot,
    env: validationEnvironment,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Validation failed');
  process.exitCode = 2;
});
