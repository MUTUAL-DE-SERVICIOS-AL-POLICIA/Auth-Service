import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import { UserListDto } from './dto/user-list.dto';
import { UserDetailDto } from './dto/user-detail.dto';
import { ManagementRoleDto } from './dto/management-rol-dto';

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

  @MessagePattern('get_user_management_roles')
  async getUserManagementRoles(userId: any): Promise<ManagementRoleDto[]> {
    console.log('El usuario autenticado es:', userId.userId);
    return this.userService.getUserManagementRoles(userId.userId);
  }
}
