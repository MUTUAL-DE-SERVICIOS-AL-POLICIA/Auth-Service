import { IsString, IsUUID, IsDate, IsNumber } from 'class-validator';

export class UserDto {
  @IsNumber()
  id: number;

  @IsUUID()
  uuid: string;

  @IsString()
  username: string;

  @IsString()
  name: string;

  @IsString()
  position: string;

  @IsDate()
  createdAt: Date;
}
