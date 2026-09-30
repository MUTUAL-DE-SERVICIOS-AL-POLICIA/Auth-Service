#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const manifestPath =
  process.argv[2] ??
  fileURLToPath(new URL('../config/web-auth.expected.json', import.meta.url));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function origin(value, name) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin`);
  }
  return url.toString().replace(/\/$/, '');
}

function splitPostLogoutUris(value) {
  return typeof value === 'string'
    ? value
        .split('##')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

async function adminToken(baseUrl) {
  const supplied = process.env.KEYCLOAK_ADMIN_TOKEN?.trim();
  if (supplied) return supplied;

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: required('KEYCLOAK_ADMIN_USERNAME'),
    password: required('KEYCLOAK_ADMIN_PASSWORD'),
  });
  const adminRealm = process.env.KEYCLOAK_ADMIN_REALM?.trim() || 'master';
  const response = await fetch(
    `${baseUrl}/realms/${encodeURIComponent(adminRealm)}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Keycloak admin authentication failed with HTTP ${response.status}`,
    );
  }
  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token
  ) {
    throw new Error(
      'Keycloak admin authentication returned an invalid response',
    );
  }
  return payload.access_token;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof manifest.realm !== 'string' ||
    !Array.isArray(manifest.clients)
  ) {
    throw new Error('Expected configuration manifest is invalid');
  }

  const baseUrl = origin(required('KEYCLOAK_ADMIN_URL'), 'KEYCLOAK_ADMIN_URL');
  const token = await adminToken(baseUrl);
  const realm = encodeURIComponent(manifest.realm);
  const problems = [];

  async function get(path) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Keycloak read failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  const realmRepresentation = await get(`/admin/realms/${realm}`);
  if (realmRepresentation.enabled !== true) {
    problems.push(`realm ${manifest.realm} is disabled`);
  }

  for (const expected of manifest.clients) {
    const matches = await get(
      `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(expected.clientId)}`,
    );
    if (!Array.isArray(matches) || matches.length !== 1) {
      problems.push(
        `client ${expected.clientId} expected exactly once; found ${Array.isArray(matches) ? matches.length : 'invalid response'}`,
      );
      continue;
    }

    const client = matches[0];
    for (const field of [
      'enabled',
      'protocol',
      'standardFlowEnabled',
      'directAccessGrantsEnabled',
      'authorizationServicesEnabled',
    ]) {
      if (Object.hasOwn(expected, field) && client[field] !== expected[field]) {
        problems.push(`client ${expected.clientId} has unexpected ${field}`);
      }
    }

    if (expected.clientId === 'hub-interface') {
      const callback = required('OIDC_HUB_CALLBACK_URL');
      const postLogout = required('OIDC_HUB_POST_LOGOUT_REDIRECT_URL');
      const backchannel = required('KEYCLOAK_BACKCHANNEL_LOGOUT_URL');
      const clientType = required('OIDC_HUB_CLIENT_TYPE');
      if (!['public', 'confidential'].includes(clientType)) {
        throw new Error('OIDC_HUB_CLIENT_TYPE must be public or confidential');
      }
      if (client.publicClient !== (clientType === 'public')) {
        problems.push('hub-interface has an unexpected client type');
      }
      const webOrigins = Array.isArray(client.webOrigins)
        ? client.webOrigins
        : [];
      if (
        webOrigins.includes('*') ||
        webOrigins.some(
          (entry) => typeof entry === 'string' && entry.includes('*'),
        )
      ) {
        problems.push('hub-interface web origins must not contain wildcards');
      }
      if (
        !Array.isArray(client.redirectUris) ||
        !client.redirectUris.includes(callback)
      ) {
        problems.push('hub-interface is missing the exact callback URI');
      }
      const postLogoutUris = splitPostLogoutUris(
        client.attributes?.['post.logout.redirect.uris'],
      );
      if (!postLogoutUris.includes(postLogout)) {
        const mode = postLogoutUris.includes('+')
          ? 'derived (+)'
          : postLogoutUris.includes('*') ||
              postLogoutUris.some(
                (entry) => typeof entry === 'string' && entry.includes('*'),
              )
            ? 'wildcard'
            : postLogoutUris.length
              ? 'different'
              : 'empty';
        problems.push(
          `hub-interface is missing the exact post logout redirect URI; configured mode: ${mode}`,
        );
      }
      if (client.attributes?.['backchannel.logout.url'] !== backchannel) {
        problems.push('hub-interface has an unexpected backchannel logout URL');
      }
      if (
        client.attributes?.['backchannel.logout.session.required'] !== 'true'
      ) {
        problems.push(
          'hub-interface does not require the backchannel session identifier',
        );
      }
    }

    if (Array.isArray(expected.clientRoles)) {
      const roles = await get(
        `/admin/realms/${realm}/clients/${encodeURIComponent(client.id)}/roles?max=1000`,
      );
      if (!Array.isArray(roles)) {
        problems.push(
          `client ${expected.clientId} returned an invalid role list`,
        );
      } else {
        const roleNames = new Set(
          roles
            .map((role) => role?.name)
            .filter((name) => typeof name === 'string'),
        );
        for (const role of expected.clientRoles) {
          if (!roleNames.has(role)) {
            problems.push(
              `client ${expected.clientId} is missing role ${role}`,
            );
          }
        }
      }
    }

    if (Array.isArray(expected.resources)) {
      const resources = await get(
        `/admin/realms/${realm}/clients/${encodeURIComponent(client.id)}/authz/resource-server/resource?max=1000`,
      );
      if (!Array.isArray(resources)) {
        problems.push(
          `client ${expected.clientId} returned an invalid resource list`,
        );
        continue;
      }
      for (const expectedResource of expected.resources) {
        const resource = resources.find(
          (candidate) => candidate?.name === expectedResource.name,
        );
        if (!resource) {
          problems.push(
            `client ${expected.clientId} is missing resource ${expectedResource.name}`,
          );
          continue;
        }
        const scopes = new Set(
          Array.isArray(resource.scopes)
            ? resource.scopes
                .map((scope) => scope?.name)
                .filter((name) => typeof name === 'string')
            : [],
        );
        for (const scope of expectedResource.scopes) {
          if (!scopes.has(scope)) {
            problems.push(
              `resource ${expectedResource.name} is missing scope ${scope}`,
            );
          }
        }
      }
    }
  }

  if (manifest.requireLdap === true) {
    const components = await get(
      `/admin/realms/${realm}/components?type=${encodeURIComponent('org.keycloak.storage.UserStorageProvider')}`,
    );
    const activeLdap = Array.isArray(components)
      ? components.some(
          (component) =>
            component?.providerId === 'ldap' &&
            component?.config?.enabled?.[0] !== 'false',
        )
      : false;
    if (!activeLdap) {
      problems.push('realm is missing an enabled LDAP user storage provider');
    }
  }

  if (problems.length) {
    console.error(
      `Keycloak validation failed with ${problems.length} difference(s):`,
    );
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Keycloak validation passed for realm ${manifest.realm} and ${manifest.clients.length} clients`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Keycloak validation failed',
  );
  process.exitCode = 2;
});
