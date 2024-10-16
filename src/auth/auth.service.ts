import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { envs } from 'src/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  constructor(private readonly jwtService: JwtService) {}

  async generateJwt(user: any): Promise<string> {
    this.logger.debug(user);
    const payload = { username: user.uid }; // Ajusta el payload con los datos que necesites
    return this.jwtService.sign(payload);
  }

  async verifyToken(token: string): Promise<boolean> {
    try {
      const { sub, iat, exp, ...user } = this.jwtService.verify(token, {
        secret: envs.jwtSecret,
      });
      this.logger.debug('valid token');
      return true;
    } catch (error) {
      this.logger.error(error);
      throw new RpcException({
        status: 401,
        message: 'Invalid token',
      });
    }
  }
}
