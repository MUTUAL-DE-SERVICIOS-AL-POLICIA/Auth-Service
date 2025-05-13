import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity({ schema: 'auth', name: 'user_management_modules' })
export class UserManagementModule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  moduleId: number;

  @ManyToOne(() => User, (user) => user.userManagementModules)
  user: User;
}
