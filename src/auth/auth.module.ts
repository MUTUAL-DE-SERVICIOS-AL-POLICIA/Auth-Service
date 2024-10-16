import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { LdapStrategy } from './strategies/ldap.strategy';
import { AuthController } from './auth.controller';
import { LdapAuthGuard } from './ldap-auth.guard';
import { AuthService } from './auth.service';
import { envs } from 'src/config';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      global: true,
      secret: envs.jwtSecret,
      signOptions: { expiresIn: '4h' },
    }),
  ],
  controllers: [AuthController],
  providers: [LdapStrategy, LdapAuthGuard, AuthService],
})
export class AuthModule {}
