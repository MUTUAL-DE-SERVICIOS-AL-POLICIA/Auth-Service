import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { SecretEnvs } from 'src/config';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(private readonly jwtService: JwtService) {}

  async generateJwtWithUserDetails(user: any): Promise<any> {
    const tokenPayload: JwtPayload = {
      user: { id: user.id, username: user.username, name: user.name },
    };
    const jwt = await this.jwtService.sign(tokenPayload);
    const moduleMap = new Map<
      number,
      {
        id: number;
        name: string;
        urlProd: string;
        urlDev: string;
        urlManual: string;
        roles: { id: number; name: string }[];
      }
    >();

    for (const userRole of user.userRoles || []) {
      const role = userRole.role;
      const module = role.module;
      if (!moduleMap.has(module.id)) {
        moduleMap.set(module.id, {
          id: module.id,
          name: module.name,
          urlProd: module.urlProd,
          urlDev: module.urlDev,
          urlManual: module.urlManual,
          roles: [],
        });
      }
      moduleMap.get(module.id).roles.push({
        id: role.id,
        name: role.name,
      });
    }
    const modulesOnly = Array.from(moduleMap.values()).map((mod) => ({
      id: mod.id,
      name: mod.name,
      urlProd: mod.urlProd,
      urlDev: mod.urlDev,
      urlManual: mod.urlManual,
    }));
    const modulesWithRoles = Array.from(moduleMap.values());
    const payload = {
      access_token: jwt,
      user: {
        data: {
          id: user.id,
          username: user.username,
          name: user.name,
        },
        modules: modulesOnly,
        modulesWithRoles: modulesWithRoles,
      },
    };
    return payload;
  }
  async verifyToken(token: string): Promise<string> {
    try {
      const { user } = this.jwtService.verify(token, {
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
