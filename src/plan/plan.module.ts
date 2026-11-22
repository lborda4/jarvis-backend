import { Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SubscriptionAccessController } from './subscription-access.controller';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { JarvisSalesInvoice } from '../integration/jarvis/entities/jarvis-sales-invoice.entity';
import { JarvisRadianEvent } from '../integration/jarvis/entities/jarvis-radian-event.entity';
import { IntegrationModule } from '../integration/integration.module';
import { Plan } from './entities/plan.entity';
import { PlanSubscriptionService } from './plan-subscription.service';
import { PlansRepository } from './repositories/plans.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, ElectronicDocument, JarvisSalesInvoice, JarvisRadianEvent]),
    forwardRef(() => IntegrationModule),
  ],
  controllers: [SubscriptionAccessController],
  providers: [PlansRepository, PlanSubscriptionService, { provide: APP_INTERCEPTOR, useClass: SubscriptionAccessInterceptor }],
  exports: [PlansRepository, PlanSubscriptionService, TypeOrmModule],
})
export class PlanModule {}
