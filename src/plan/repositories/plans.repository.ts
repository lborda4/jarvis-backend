import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entities/plan.entity';

@Injectable()
export class PlansRepository {
  constructor(
    @InjectRepository(Plan)
    private readonly repository: Repository<Plan>,
  ) {}

  findById(id: string): Promise<Plan | null> {
    return this.repository.findOne({ where: { id, active: true } });
  }

  findAllActive(): Promise<Plan[]> {
    return this.repository.find({
      where: { active: true },
      order: { documentLimit: 'ASC', name: 'ASC' },
    });
  }
}
