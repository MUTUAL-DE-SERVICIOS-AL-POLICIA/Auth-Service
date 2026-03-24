import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class VerifyTokenDto {
  @IsString()
  sid!: string;

  @IsOptional()
  clockSkewSec?: number;
  
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  origin?: string;
  
  @IsOptional()
  @IsBoolean()
  checkAzp?: boolean;
}
export class VerifyTokenRes {
  ok: true;
  exists!: boolean;
  isValid!: boolean;
}