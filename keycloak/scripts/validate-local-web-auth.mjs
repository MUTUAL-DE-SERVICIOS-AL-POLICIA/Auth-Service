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

async function main() {
  const root = await loadEnvironment('.env');
  const auth = await loadEnvironment('Auth-Service/.env.compose');

  const callback = new URL(
    required(auth, 'OIDC_HUB_CALLBACK_URL', 'Auth-Service/.env.compose'),
  );
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
    KEYCLOAK_ADMIN_URL: required(
      auth,
      'KC_HOSTNAME',
      'Auth-Service/.env.compose',
    ).replace(/\/$/u, ''),
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
    OIDC_HUB_CALLBACK_URL: callback.toString(),
    OIDC_HUB_POST_LOGOUT_REDIRECT_URL: required(
      auth,
      'OIDC_HUB_POST_LOGOUT_REDIRECT_URL',
      'Auth-Service/.env.compose',
    ),
    OIDC_HUB_CLIENT_TYPE: required(
      auth,
      'OIDC_HUB_CLIENT_TYPE',
      'Auth-Service/.env.compose',
    ),
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
