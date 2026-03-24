import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  LoginStartDto,
  LoginStartResDto,
  ExchangeCodeDto,
  ExchangeCodeResDto,
  VerifyTokenDto,
  VerifyTokenRes,
  LogoutDto,
  LogoutRes,
  GetProfileDto,
  GetProfileRes,
  GetPermissionsDto,
  GetPermissionsRes,
  EvaluatePermissionDto,
  EvaluatePermissionRes,
  TokenExchangeDto,
  TokenExchangeRes,
} from './dto';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @MessagePattern('auth.login.start')
  async loginStart(@Payload() dto: LoginStartDto): Promise<LoginStartResDto> {
    console.log(dto);
    const { url, state } = await this.auth.loginStartHandler(dto);
    return { ok: true, url, state };
  }

  @MessagePattern('auth.login.exchange')
  async loginExchange(
    @Payload() dto: ExchangeCodeDto,
  ): Promise<ExchangeCodeResDto> {
    return await this.auth.exchangeCode(dto);
  }

  @MessagePattern('auth.logout')
  async logout(@Payload() dto: LogoutDto): Promise<LogoutRes> {
    await this.auth.logout(dto);
    return { ok: true };
  }

  @MessagePattern('auth.profile.get')
  async profileGet(@Payload() dto: GetProfileDto): Promise<GetProfileRes> {
    try {
      return await this.auth.getProfileByCtx({ 
        sid: dto.sid,
        clientId: dto.clientId,
        origin: dto.origin,
      });
    } catch (e: any) {
      throw new RpcException(e?.message ?? 'PROFILE_LOOKUP_FAILED');
    }
  }


  @MessagePattern('auth.token.verify')
  async verifyToken(@Payload() dto: VerifyTokenDto): Promise<VerifyTokenRes> {
    try {
      return await this.auth.verifyToken(dto);
    } catch (e: any) {
      throw new RpcException(e?.message ?? 'TOKEN_VERIFY_FAILED');
    }
  }

  @MessagePattern('auth.permissions.list')
  async permissionsList(
    @Payload() dto: GetPermissionsDto,
  ): Promise<GetPermissionsRes> {
    try {
      return await this.auth.getPermissions(dto);
    } catch (e: any) {
      throw new RpcException(e?.message ?? 'PERMISSIONS_LIST_FAILED');
    }
  }

  @MessagePattern('auth.permission.evaluate')
  async permissionEvaluate(
    @Payload() dto: EvaluatePermissionDto,
  ): Promise<EvaluatePermissionRes> {
    try {
      return await this.auth.evaluatePermission(dto);
    } catch (e: any) {
      throw new RpcException(e?.message ?? 'PERMISSION_EVALUATE_FAILED');
    }
  }

  @MessagePattern('auth.token.exchange')
  async tokenExchange(
    @Payload() dto: TokenExchangeDto,
  ): Promise<TokenExchangeRes> {
    try {
      return await this.auth.tokenExchange(dto);
    } catch (e: any) {
      throw new RpcException(e?.message ?? 'TOKEN_EXCHANGE_FAILED');
    }
  }

}