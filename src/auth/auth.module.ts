import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecretEnvs } from 'src/config';
import { SessionModule } from 'src/session/session.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: SecretEnvs.jwtSecret,
      signOptions: { expiresIn: '4h' },
    }),
    SessionModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
