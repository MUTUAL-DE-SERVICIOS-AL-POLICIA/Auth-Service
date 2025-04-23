import { IsString, IsUUID } from 'class-validator';

export class UserDetailDto {
  @IsUUID()
  uuid: string;

  @IsString()
  username: string;

  @IsString()
  name: string;

  @IsString()
  cellphone: string;

  @IsString()
  identityCard: string;

  @IsString()
  position: string;
}
