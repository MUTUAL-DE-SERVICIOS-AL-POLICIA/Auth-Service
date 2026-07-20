import { Module } from '@nestjs/common';
import { AuthBcbService } from './auth-bcb.service';
import { AuthBcbController } from './auth-bcb.controller';
import { JwtModule } from '@nestjs/jwt';
import { BcbJwtEnvs } from 'src/config';

@Module({
  controllers: [AuthBcbController],
  providers: [AuthBcbService],
  imports: [
    JwtModule.register({
    privateKey: BcbJwtEnvs.jwtPrivateKey?.replace(/\\n/g, '\n'),
    publicKey: BcbJwtEnvs.jwtPublicKey?.replace(/\\n/g, '\n'),
    signOptions: { algorithm: 'RS256' },
    verifyOptions: { algorithms: ['RS256'] },
    })
  ],
})
export class AuthBcbModule {}