import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Client } from 'ldapts';
import { LegacyAuthEnvs } from 'src/config';

@Injectable()
export class LdapService {
  async findUser(
    username: string,
    password: string,
  ): Promise<{
    username: string;
    names: string;
    surnames: string;
  }> {
    const client = new Client({
      url: `ldap://${LegacyAuthEnvs.ldapHost}:${LegacyAuthEnvs.ldapPort}`,
      connectTimeout: 5000,
    });

    try {
      const bindDn = `${LegacyAuthEnvs.ldapAdminPrefix}=${LegacyAuthEnvs.ldapAdminUsername},${LegacyAuthEnvs.ldapBaseDn}`;
      await client.bind(bindDn, LegacyAuthEnvs.ldapAdminPassword);
      const { searchEntries } = await client.search(LegacyAuthEnvs.ldapBaseDn, {
        scope: 'sub',
        filter: `(uid=${username})`,
        attributes: ['uid', 'givenName', 'sn'],
      });
      if (searchEntries.length === 0) {
        throw new UnauthorizedException('Usuario no encontrado');
      }
      const user = searchEntries[0];
      await client.bind(user.dn, password);
      return {
        username: String(user.uid),
        names: String(user.givenName ?? ''),
        surnames: String(user.sn ?? ''),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Credenciales incorrectas');
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
