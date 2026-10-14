import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { JarvisRadianEvent } from '../entities/jarvis-radian-event.entity';
import type { RadianEventResult } from '../nextpyme/nextpyme-radian-result';

@Injectable()
export class JarvisRadianEventsRepository {
  constructor(private readonly source: DataSource) {}

  list(companyId: string, cufe: string) {
    return this.source
      .getRepository(JarvisRadianEvent)
      .find({ where: { companyId, cufe }, order: { eventId: 'ASC' } });
  }

  async claim(
    companyId: string,
    cufe: string,
    eventId: number,
    rejectionId: number | null,
  ) {
    return this.source.transaction(async (manager) => {
      // Serialize claims for the whole invoice, including mutually exclusive final events.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`radian:${companyId}:${cufe}`],
      );
      const repo = manager.getRepository(JarvisRadianEvent);
      const rows = await repo.find({ where: { companyId, cufe } });
      const row = rows.find((item) => item.eventId === eventId);
      if (row && row.status !== 'failed') return { claimed: false, row };
      if (
        [2, 4].includes(eventId) &&
        rows.some(
          (item) =>
            item.eventId === (eventId === 2 ? 4 : 2) &&
            item.status !== 'failed',
        )
      ) {
        throw new BadRequestException(
          'La factura ya tiene un evento final confirmado o por confirmar.',
        );
      }
      const prerequisites = eventId === 1 ? [] : eventId === 3 ? [1] : [1, 3];
      if (
        rows.some(
          (item) =>
            prerequisites.includes(item.eventId) && item.status !== 'sent',
        )
      ) {
        throw new BadRequestException(
          'Confirma los eventos anteriores antes de continuar.',
        );
      }
      const next = await repo.save(
        repo.create({
          companyId,
          cufe,
          eventId,
          rejectionId,
          status: 'processing',
          attemptId: randomUUID(),
          cude: null,
          dianCode: null,
          message: null,
          response: null,
        }),
      );
      return { claimed: true, row: next };
    });
  }

  async complete(row: JarvisRadianEvent, result: RadianEventResult) {
    // The attempt ID prevents a late response from overwriting a newer attempt.
    await this.source.query(
      `UPDATE jarvis_radian_events SET status=$1, cude=COALESCE($2,cude),
      dian_code=$3, message=$4, response=$5::jsonb, updated_at=now(),
      history=history || jsonb_build_array(jsonb_build_object('attemptId',attempt_id,'recordedAt',now(),'result',$6::jsonb))
      WHERE company_id=$7 AND cufe=$8 AND event_id=$9 AND attempt_id=$10
      AND (status <> 'sent' OR $1 = 'sent')`,
      [
        result.status,
        result.cude ?? null,
        result.dianCode ?? null,
        result.message ?? null,
        JSON.stringify(result.response ?? null),
        JSON.stringify(result),
        row.companyId,
        row.cufe,
        row.eventId,
        row.attemptId,
      ],
    );
  }
}
