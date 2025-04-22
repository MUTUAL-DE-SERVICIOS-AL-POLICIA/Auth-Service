import {
  Column,
  Entity,
  Generated,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ManagementRole } from './management-role.entity';

@Entity({ schema: 'auth', name: 'units' })
export class Unit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @Column()
  name: string;

  @OneToMany(() => ManagementRole, (managementRole) => managementRole.unit)
  managementRoles: ManagementRole[];
}
