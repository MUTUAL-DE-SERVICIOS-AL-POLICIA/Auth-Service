import { UserDto } from './user.dto';
import { PickType } from '@nestjs/mapped-types';

export class UserListDto extends PickType(UserDto, [
  'uuid',
  'position',
  'name',
] as const) {}
