import { IsOptional, IsString } from 'class-validator';

export class TokenExchangeDto {
  @IsString()
  sid!: string;

  /** Se puede omitir; el requester real será siempre hubClientId */
  @IsOptional()
  @IsString()
  clientId?: string;

  /** Cliente destino / audience del token resultante */
  @IsString()
  audience!: string;
}

export type TokenExchangeRes = {
  ok: true;
  profile: {
    sub: string;
    username?: string;
    name?: string;
    givenName?: string;
    familyName?: string;
    email?: string;
    roles: string[];
  };
};