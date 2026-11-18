import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthBcbService {
  constructor(private readonly jwtService: JwtService) {}

  async generateBcbJwt(): Promise<string> {
    const payload = {
      sub: 'BCB-Service',
      type: 'service',
      scopes: ['bcb:read'],
      iss: 'bcb-auth-service',
    };
    return this.jwtService.sign(payload);
  }
  async verifyBcbJwt(token: string): Promise<any> {
    try {
      const decoded = this.jwtService.verify(token, {
        algorithms: ['RS256'],
      });
      return decoded;
    } catch (error) {
      throw new Error('Invalid BCB JWT');
    }
  }
}
