import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('advisors')
export class Advisor {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid', unique: true }) userId: string;
  @OneToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ name: 'commission_type', type: 'varchar', length: 10, default: 'FIXED' }) commissionType: 'FIXED' | 'PERCENT';
  @Column({ name: 'commission_value', type: 'numeric', precision: 14, scale: 2, nullable: true }) commissionValue: string | null;
  @Column({ name: 'registered_at', type: 'timestamptz', nullable: true }) registeredAt: Date | null;
  @Column({ name: 'invitation_hash', type: 'varchar', length: 64, nullable: true, select: false }) invitationHash: string | null;
  @Column({ name: 'invitation_expires_at', type: 'timestamptz', nullable: true, select: false }) invitationExpiresAt: Date | null;
  @Column({ name: 'last_delivery_status', type: 'varchar', length: 10, nullable: true }) lastDeliveryStatus: 'SENT' | 'FAILED' | null;
  @Column({ name: 'last_invited_at', type: 'timestamptz', nullable: true }) lastInvitedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
