import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { UserCompany } from './user-company.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 50, default: UserRole.USER })
  role: UserRole;

  @Column({ name: 'accepted_privacy_at', type: 'timestamp', nullable: true })
  acceptedPrivacyAt: Date | null;

  @Column({
    name: 'privacy_policy_version',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  privacyPolicyVersion: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => UserCompany, (userCompany) => userCompany.user)
  userCompanies: UserCompany[];
}
