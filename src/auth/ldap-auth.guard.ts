import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AuthGuard } from '@nestjs/passport';
import { PvtbeEnvs } from 'src/config';

@Injectable()
export class LdapAuthGuard extends AuthGuard('ldap') {
  private readonly logger = new Logger('LdapAuthGuard');
  canActivate(context: ExecutionContext) {
    const { username, password } = context.switchToHttp().getRequest();
    if (
      username == PvtbeEnvs.pvtbeUsername &&
      password == PvtbeEnvs.pvtbePassword
    )
      return true;
    return super.canActivate(context);
  }
  handleRequest(err, user) {
    if (err || !user) {
      // Puedes personalizar el mensaje de error aquí
      throw err || new RpcException('Credenciales inválidas');
    }
    return user;
  }
}
