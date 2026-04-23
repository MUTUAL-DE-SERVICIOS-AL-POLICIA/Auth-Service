import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecretEnvs } from 'src/config';
import { Permission } from './entities/permissions.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  imports: [
    TypeOrmModule.forFeature([
      Permission,
    ]),
    JwtModule.register({
      global: true,
      secret: SecretEnvs.jwtSecret,
      signOptions: { expiresIn: '4h' },
    }),
  ],

})
export class AuthModule {}
