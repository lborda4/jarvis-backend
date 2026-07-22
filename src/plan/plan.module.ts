import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './entities/plan.entity';
import { PlansRepository } from './repositories/plans.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Plan])],
  providers: [PlansRepository],
  exports: [PlansRepository, TypeOrmModule],
})
export class PlanModule {}
