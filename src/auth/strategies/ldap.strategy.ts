import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';
import { envs } from 'src/config';

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldap') {
  constructor() {
    super({
      server: {
        url: 'ldap://' + envs.ldapHost + ':' + envs.ldapPort, // URL de tu servidor LDAP
        bindDN:
          envs.ldapAdminPrefix +
          '=' +
          envs.ldapAdminUsername +
          ',' +
          envs.ldapBaseDN, // Usuario administrador para LDAP
        bindCredentials: envs.ldapAdminPassword, // Contraseña del administrador
        searchBase: envs.ldapBaseDN, // Base de búsqueda LDAP
        searchFilter: '(uid={{username}})', // Filtro de búsqueda, basado en el nombre de usuario
        searchAttributes: ['uid', 'cn'],
      },
      credentialsLookup: (req: { username: any; password: any }) => {
        return {
          username: req.username,
          password: req.password,
        };
      },
    });
  }

  async validate(user: any): Promise<any> {
    // Aquí puedes personalizar lo que devuelves después de la autenticación exitosa
    if (!user) {
      throw new RpcException('user not found');
    }
    return user;
  }
}
