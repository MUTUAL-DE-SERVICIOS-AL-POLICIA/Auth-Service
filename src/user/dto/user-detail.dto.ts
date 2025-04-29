import { PickType } from '@nestjs/mapped-types';
import { UserDto } from './user.dto';

export class UserDetailDto extends PickType(UserDto, [
  'uuid',
  'username',
  'name',
  'position',
] as const) {}
