import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Generated,
  OneToMany,
} from 'typeorm';
import { UserRole } from './user-role.entity';
import { UserManagementRole } from './user-management-role.entity';

@Entity({ schema: 'auth', name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @Column({ unique: true })
  username: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  position: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles: UserRole[];

  @OneToMany(() => UserRole, (userRole) => userRole.createdBy)
  createdUserRoles: UserRole[];

  @OneToMany(
    () => UserManagementRole,
    (userManagementRole) => userManagementRole.user,
  )
  userManagementRoles: UserManagementRole[];
}
