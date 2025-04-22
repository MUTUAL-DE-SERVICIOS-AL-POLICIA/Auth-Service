import {
  Column,
  Entity,
  Generated,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Unit } from './unit.entity';
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

  @ManyToOne(() => Unit, (unit) => unit.managementRoles)
  unit: Unit;

  @OneToMany(
    () => UserManagementRole,
    (userManagementRole) => userManagementRole.managementRole,
  )
  userManagementRoles: UserManagementRole[];
}
