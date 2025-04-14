import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import Strategy from 'passport-ldapauth';
import { LdapEnvs } from 'src/config';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldap') {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      server: {
        url: 'ldap://' + LdapEnvs.ldapHost + ':' + LdapEnvs.ldapPort, // URL de tu servidor LDAP
        bindDN:
          LdapEnvs.ldapAdminPrefix +
          '=' +
          LdapEnvs.ldapAdminUsername +
          ',' +
          LdapEnvs.ldapBaseDN, // Usuario administrador para LDAP
        bindCredentials: LdapEnvs.ldapAdminPassword, // Contraseña del administrador
        searchBase: LdapEnvs.ldapBaseDN, // Base de búsqueda LDAP
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
    const userAuth = await this.userRepository.findOne({
      where: { username: user.uid },
      relations: [
        'userManagementRoles',
        'userRoles',
        'userRoles.role',
        'userRoles.role.module',
      ],
    });

    if (!userAuth) {
      throw new RpcException({ message: 'user not found', statusCode: 401 });
    }
    return userAuth;
  }
}
