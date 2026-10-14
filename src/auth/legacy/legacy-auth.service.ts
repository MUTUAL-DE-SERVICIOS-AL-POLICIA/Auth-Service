import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { LdapService } from 'src/common';
import { LegacyAuthEnvs } from 'src/config';

@Injectable()
export class LegacyAuthService {
  private readonly logger = new Logger(LegacyAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly ldap: LdapService,
  ) {}

  async login(username: string, password: string) {
    try {
      const user =
        LegacyAuthEnvs.environment === 'dev'
          ? { username, name: username }
          : await this.ldap.findUser(username, password).then((entry) => ({
              username: entry.username,
              name: `${entry.names} ${entry.surnames}`.trim(),
            }));
      return {
        access_token: await this.jwt.signAsync(user),
        user,
        access: [],
      };
    } catch {
      throw new RpcException({
        message: 'Invalid credentials',
        statusCode: 401,
      });
    }
  }

  async verifyToken(token: string) {
    try {
      return await this.jwt.verifyAsync(token);
    } catch {
      this.logger.warn('Legacy token verification failed');
      throw new RpcException({ message: 'Invalid token', statusCode: 401 });
    }
  }

  verifyApiKey(apiKey: string): true {
    if (apiKey !== LegacyAuthEnvs.apiKey) {
      throw new RpcException({ message: 'Invalid api key', statusCode: 401 });
    }
    return true;
  }
}
