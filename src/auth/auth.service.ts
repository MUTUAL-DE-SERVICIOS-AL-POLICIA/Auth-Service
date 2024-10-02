import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async generateJwt(user: any): Promise<string> {
    const payload = { username: user.uid, sub: user.dn }; // Ajusta el payload con los datos que necesites
    return this.jwtService.sign(payload);
  }
}
