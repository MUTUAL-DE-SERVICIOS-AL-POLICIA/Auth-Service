import { ExecutionContext, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LdapAuthGuard extends AuthGuard('ldap') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
  handleRequest(err, user, info) {
    if (err || !user) {
      // Puedes personalizar el mensaje de error aquí
      throw err || new RpcException(info?.message || 'Credenciales inválidas');
    }
    return user;
  }
}
