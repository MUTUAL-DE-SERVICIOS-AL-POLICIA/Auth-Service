import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import { UserListDto } from './dto/user-list.dto';
import { UserDetailDto } from './dto/user-detail.dto';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern('get_all_users')
  async findAll(): Promise<UserListDto[]> {
    return this.userService.findAll();
  }

  @MessagePattern('get_user')
  async findOne(@Payload() data: { uuid: string }): Promise<UserDetailDto> {
    return this.userService.findOne(data.uuid);
  }
}
