import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Client } from 'ldapts';
import { LdapEnvs } from 'src/config';

@Injectable()
export class LdapService {

  private createClient(): Client {
    return new Client({
      url: `ldap://${LdapEnvs.ldapHost}:${LdapEnvs.ldapPort}`,
      connectTimeout: 5000,
    });
  }

  async findUser(username: string, password: string): Promise<any> {

    const client = await this.createClient();

    try {
      const bindDN = `${LdapEnvs.ldapAdminPrefix}=${LdapEnvs.ldapAdminUsername},${LdapEnvs.ldapBaseDN}`;
      await client.bind(bindDN, LdapEnvs.ldapAdminPassword);

      const { searchEntries } = await client.search(LdapEnvs.ldapBaseDN, {
        scope: 'sub',
        filter: `(uid=${username})`,
        attributes: ['uid', 'cn', 'givenName', 'sn', 'mail', 'title'],
      });

      if (searchEntries.length === 0) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      const userDN = searchEntries[0];

      await client.bind(userDN.dn, password);

      return {
        username: userDN.uid,
        fullname: userDN.cn,
        names: userDN.givenName,
        surnames: userDN.sn,
        mail: userDN.mail,
        title: userDN.title,
        error: false,
      };

    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Credenciales incorrectas');
    } finally {
      await client.unbind();
    }
  }
}