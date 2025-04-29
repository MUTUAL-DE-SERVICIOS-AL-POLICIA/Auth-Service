import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserListDto } from './dto/user-list.dto';
import { plainToInstance } from 'class-transformer';
import { UserDetailDto } from './dto/user-detail.dto';
import { RpcException } from '@nestjs/microservices';
import { ManagementRoleDto } from './dto/management-rol-dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findAll(): Promise<UserListDto[]> {
    const users = await this.userRepository.find({
      select: ['uuid', 'position', 'name'],
    });
    return plainToInstance(UserListDto, users);
  }

  async findOne(uuid: string): Promise<UserDetailDto> {
    const user = await this.userRepository.findOne({
      where: { uuid },
      select: ['uuid', 'username', 'name', 'position'],
    });

    if (!user) {
      throw new RpcException({
        message: `user with: ${uuid} not found`,
        code: 404,
      });
    }
    return plainToInstance(UserDetailDto, user);
  }

  async getUserManagementRoles(userId: any): Promise<ManagementRoleDto[]> {
    const userWithRoles = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['userManagementRoles', 'userManagementRoles.managementRole'],
      select: {
        id: true,
        userManagementRoles: {
          id: true,
          managementRole: {
            id: true,
            name: true,
          },
        },
      },
    });
    return userWithRoles.userManagementRoles.map((umr) => ({
      id: umr.managementRole.id,
      name: umr.managementRole.name,
    }));
  }
}
