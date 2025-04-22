import { ManagementRole } from './management-role.entity';
import { Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity({ schema: 'auth', name: 'user_management_roles' })
export class UserManagementRole {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(
    () => ManagementRole,
    (managementRole) => managementRole.userManagementRoles,
  )
  managementRole: ManagementRole;

  @ManyToOne(() => User, (user) => user.userManagementRoles)
  user: User;
}
