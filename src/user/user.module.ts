import { Module as NestModule } from '@nestjs/common';;
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { ManagementRole } from './entities/management-role.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { UserManagementRole } from './entities/user-management-role.entity';
import { Module } from './entities/module.entity';

@NestModule({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ManagementRole,
      Role,
      Module,
      UserRole,
      UserManagementRole,
    ]),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [TypeOrmModule],
})
export class UserModule {}
