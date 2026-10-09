import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoldWebhookEvent } from '../entities/bold-webhook-event.entity';

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code =
    (error as { code?: string }).code ??
    (error as { driverError?: { code?: string } }).driverError?.code;
  return code === '23505';
}

@Injectable()
export class BoldWebhookEventsRepository {
  constructor(
    @InjectRepository(BoldWebhookEvent)
    private readonly repository: Repository<BoldWebhookEvent>,
  ) {}

  async insertIfNew(
    data: Pick<
      BoldWebhookEvent,
      | 'notificationId'
      | 'companyId'
      | 'type'
      | 'paymentId'
      | 'reference'
      | 'merchantId'
      | 'amountTotal'
      | 'amountCurrency'
      | 'payload'
    >,
  ): Promise<'inserted' | 'duplicate'> {
    try {
      await this.repository.insert(data);
      return 'inserted';
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }
}
