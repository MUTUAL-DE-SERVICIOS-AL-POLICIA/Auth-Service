import { IsOptional, IsString } from 'class-validator';

export class ExchangeCodeDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsString()
  sid?: string;
}

export interface ExchangeCodeResDto {
  ok: true;
  sid: string;
  returnTo: string;
  profile: {
    sub: string;
    username?: string;
    name?: string;
    givenName?: string;
    familyName?: string;
    email?: string;
    roles: string[];
  };
}