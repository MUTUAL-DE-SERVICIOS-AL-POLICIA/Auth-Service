import {
  Column,
  Entity,
  Generated,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from './role.entity';

@Entity({ schema: 'auth', name: 'modules' })
export class Module {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @Column()
  name: string;

  @OneToMany(() => Role, (role) => role.module)
  roles: Role[];
}
