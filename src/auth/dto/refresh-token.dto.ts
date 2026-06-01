import { IsString } from 'class-validator';
export class RefreshTokenDto {
  @IsString() sid!: string;
  @IsString() clientId!: string;
}
export type RefreshTokenRes = { ok: true; accessToken: string; expiresAt: number };