import { Module as NestModule } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { UserManagementModule } from './entities/user-management-module.entity';

@NestModule({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserRole, UserManagementModule]),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [TypeOrmModule, UserService],
})
export class UserModule {}
