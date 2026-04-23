import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { SecretEnvs, EnvironmentEnvs } from 'src/config';
import { LdapService } from 'src/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permissions.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(
    private readonly jwtService: JwtService,
    private readonly ldapService: LdapService,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
  ) {}

  async login(username: string, password: string): Promise<any> {
    let user;

    const permissions = await this.permissionsRepository.findOne({ where: { username: username } });

    if(EnvironmentEnvs.environment === 'dev') {
      user = {
        username: username,
        name: username,
      };
    } else {
      const response = await this.ldapService.findUser(username, password);
      user = {
        username: response.username,
        name: `${response.names} ${response.surnames}`,
      }
    }

    if (user.error) {
      throw new RpcException({
        message: 'Invalid credentials',
        statusCode: 401,
      });
    }

    const jwt = await this.jwtService.sign(user);

    return {
      access_token: jwt,
      user,
      access: permissions ? permissions.access : [],
    };
  }

  async verifyToken(token: string): Promise<string> {
    try {
      const user = this.jwtService.verify(token, {
        secret: SecretEnvs.jwtSecret,
      });
      return user;
    } catch (error) {
      this.logger.error(error);
      throw new RpcException({
        message: 'Invalid token',
        statusCode: 401,
      });
    }
  }

  async verifyApiKey(apiKey: string): Promise<boolean> {
    if (apiKey === SecretEnvs.apiKey) {
      return true;
    } else {
      throw new RpcException({
        message: 'Invalid api key',
        statusCode: 401,
      });
    }
  }
}
