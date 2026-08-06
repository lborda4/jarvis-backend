import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { IntegrationModule } from '../integration/integration.module';
import { Plan } from './entities/plan.entity';
import { PlanSubscriptionService } from './plan-subscription.service';
import { PlansRepository } from './repositories/plans.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, ElectronicDocument]),
    IntegrationModule,
  ],
  providers: [PlansRepository, PlanSubscriptionService],
  exports: [PlansRepository, PlanSubscriptionService, TypeOrmModule],
})
export class PlanModule {}
