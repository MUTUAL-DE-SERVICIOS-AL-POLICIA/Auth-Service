import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'auth', name: 'permissions' })
export class Permission {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Column('text', { array: true })
  access: string[];
}