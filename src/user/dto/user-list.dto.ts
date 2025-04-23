import { IsString, IsUUID } from 'class-validator';

export class UserListDto {
  @IsUUID()
  uuid: string;

  @IsString()
  name: string;

  @IsString()
  username: string;
}
