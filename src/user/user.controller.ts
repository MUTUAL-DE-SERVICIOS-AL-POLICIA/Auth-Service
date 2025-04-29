import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import { UserListDto } from './dto/user-list.dto';
import { UserDetailDto } from './dto/user-detail.dto';
import { ManagementRoleDto } from './dto/management-rol-dto';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern('user.getAll')
  async findAll(): Promise<UserListDto[]> {
    return this.userService.findAll();
  }

  @MessagePattern('user.getByUuid')
  async findOne(@Payload() data: { uuid: string }): Promise<UserDetailDto> {
    return this.userService.findOne(data.uuid);
  }

  @MessagePattern('user.ManagementRolesByUser')
  async getUserManagementRoles(userId: any): Promise<ManagementRoleDto[]> {
    return this.userService.getManagementRoles(userId.userId);
  }
}
