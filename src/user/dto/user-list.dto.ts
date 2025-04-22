import { IsString, IsUUID } from 'class-validator';

export class UserListDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsString()
  username: string;
}
