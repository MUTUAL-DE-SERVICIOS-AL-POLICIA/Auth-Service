import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { LdapStrategy } from './strategies/ldap.strategy';
import { AuthController } from './auth.controller';
import { LdapController } from '../ldap/ldap.controller';
import { LdapAuthGuard } from './ldap-auth.guard';
import { AuthService } from './auth.service';
import { LdapService } from '../ldap/ldap.service';
import { SecretEnvs } from 'src/config';
import { User } from './entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagementRole } from './entities/management-role.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { UserManagementRole } from './entities/user-management-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ManagementRole,
      Role,
      Module,
      UserRole,
      UserManagementRole,
    ]),
    PassportModule,
    JwtModule.register({
      global: true,
      secret: SecretEnvs.jwtSecret,
      signOptions: { expiresIn: '4h' },
    }),
  ],
  controllers: [AuthController, LdapController],
  providers: [LdapStrategy, LdapAuthGuard, AuthService, LdapService],
})
export class AuthModule {}
