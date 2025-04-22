import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { UserService } from './user.service';
import { UserListDto } from './dto/user-list.dto';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern('get_all_users')
  async findAll(): Promise<UserListDto[]> {
    return this.userService.findAll();
  }
}
