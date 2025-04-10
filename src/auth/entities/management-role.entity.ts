import {
  Column,
  Entity,
  Generated,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Module } from './module.entity';
import { UserManagementRole } from './user-management-role.entity';

@Entity({ schema: 'auth', name: 'management_roles' })
export class ManagementRole {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @Column()
  name: string;

  @ManyToOne(() => Module, (module) => module.roles)
  module: Module;

  @OneToMany(
    () => UserManagementRole,
    (userManagementRole) => userManagementRole.managementRole,
  )
  userManagementRoles: UserManagementRole[];
}
