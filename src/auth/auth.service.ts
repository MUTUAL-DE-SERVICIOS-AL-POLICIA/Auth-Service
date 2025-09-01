import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { SecretEnvs } from 'src/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(private readonly jwtService: JwtService) {}

  async generateJwt(user: any): Promise<string> {
    this.logger.debug(user);
    const payload = {
      username: user.uid,
    };
    return this.jwtService.sign(payload);
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
