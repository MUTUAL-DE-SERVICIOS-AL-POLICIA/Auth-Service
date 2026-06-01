import { IsString } from 'class-validator';
export class LogoutDto {
  @IsString() sid!: string;
}
export type LogoutRes = { ok: true };