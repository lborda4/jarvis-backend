import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export const PAYROLL_PREFIX = 'NI';
export const PAYROLL_NOTE_PREFIX = 'NA';
export const PAYROLL_RANGE_TO = 99999999;

/** Repairs counters from assigned numbers; legacy NI notes still occupy the NI namespace. */
export async function ensurePayrollNumbering(manager: Pick<EntityManager, 'query'>, company: string): Promise<void> {
  if (!company?.trim()) throw new BadRequestException('La empresa activa es obligatoria.');
  await manager.query(
    `INSERT INTO jarvis_payroll_settings(company_id,settings,next_number,next_note_number)
      SELECT $1::uuid,$2::jsonb,
        COALESCE(MAX(number) FILTER(WHERE prefix IS DISTINCT FROM 'NA'),0)+1,
        COALESCE(MAX(number) FILTER(WHERE prefix='NA'),0)+1
      FROM jarvis_payroll_documents WHERE company_id=$1
      ON CONFLICT(company_id) DO UPDATE SET
        settings=EXCLUDED.settings || jarvis_payroll_settings.settings || jsonb_build_object('prefix',$3::text,'notePrefix',$4::text),
        next_number=GREATEST(jarvis_payroll_settings.next_number,EXCLUDED.next_number),
        next_note_number=GREATEST(jarvis_payroll_settings.next_note_number,EXCLUDED.next_note_number),updated_at=now()
      WHERE jarvis_payroll_settings.settings->>'prefix' IS DISTINCT FROM $3::text
        OR jarvis_payroll_settings.settings->>'notePrefix' IS DISTINCT FROM $4::text
        OR jarvis_payroll_settings.next_number < EXCLUDED.next_number
        OR jarvis_payroll_settings.next_note_number < EXCLUDED.next_note_number`,
    [company, JSON.stringify({ environment: 2, prefix: PAYROLL_PREFIX, notePrefix: PAYROLL_NOTE_PREFIX, enabled: false }), PAYROLL_PREFIX, PAYROLL_NOTE_PREFIX],
  );
}
