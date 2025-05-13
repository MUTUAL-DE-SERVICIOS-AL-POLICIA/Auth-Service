import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { SecretEnvs } from 'src/config';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
  ) {}

  async generateJwtWithUserDetails(user: User): Promise<any> {
    const tokenPayload: JwtPayload = {
      user: { id: user.id, username: user.username, name: user.name },
    };
    const jwt = await this.jwtService.sign(tokenPayload);
    const modulesWithRoles = await this.userService.getModulesAndRoles(user);
    const modulesOnly = await this.userService.getModulesWithoutRoles(user);
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
