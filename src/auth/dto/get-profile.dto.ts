import { IsOptional, IsString } from 'class-validator';
export class GetProfileDto {
  @IsString() sid!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  origin?: string;
}
export type GetProfileRes = {
  ok: true;
  clientId: string;
  sub?: string;
  username: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  roles?: string[];
};