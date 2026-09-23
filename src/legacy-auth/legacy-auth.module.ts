import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LegacyAuthController } from './legacy-auth.controller';
import { LegacyAuthService } from './legacy-auth.service';
import { SecretEnvs } from 'src/config';
import { Permission } from './entities/permissions.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  controllers: [LegacyAuthController],
  providers: [LegacyAuthService],
  imports: [
    TypeOrmModule.forFeature([Permission]),
    JwtModule.register({
      global: true,
      secret: SecretEnvs.jwtSecret,
      signOptions: { expiresIn: '4h' },
    }),
  ],
})
export class LegacyAuthModule {}
