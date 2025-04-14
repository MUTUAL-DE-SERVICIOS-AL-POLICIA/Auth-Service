import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { SecretEnvs } from 'src/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(private readonly jwtService: JwtService) {}

  async generateJwtWithUserDetails(user: any): Promise<any> {
    const jwt = await this.jwtService.sign({ username: user.username });
    const modules = user.userRoles?.map((ur) => ur.role?.module) || [];
    const uniqueModules = Array.from(
      new Map(modules.map((m) => [m.id, { id: m.id, name: m.name }])).values(),
    );
    const roles = user.userRoles?.map((ur) => ur.role) || [];
    const payload = {
      access_token: jwt,
      user: {
        userData: {
          username: user.username,
          userId: user.id,
          name: user.name,
        },
        modules: uniqueModules,
        roles: roles,
      },
    };
    return payload;
  }
  async verifyToken(token: string): Promise<string> {
    try {
      const { username } = this.jwtService.verify(token, {
        secret: SecretEnvs.jwtSecret,
      });
      return username;
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
