import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { LdapStrategy } from './strategies/ldap.strategy';
import { AuthController } from './auth.controller';
import { LdapAuthGuard } from './ldap-auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: 'your_jwt_secret', // Cambia esta clave secreta a algo más seguro
      signOptions: { expiresIn: '1h' }, // El token expirará en 1 hora
    }),
  ],
  controllers: [AuthController],
  providers: [LdapStrategy, LdapAuthGuard, AuthService],
})
export class AuthModule {}
