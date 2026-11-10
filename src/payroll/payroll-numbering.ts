import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export const PAYROLL_PREFIX = 'SETP';

/** Initializes each company and repairs stale counters without resetting assigned numbers. */
export async function ensurePayrollNumbering(
  manager: Pick<EntityManager, 'query'>,
  company: string,
): Promise<void> {
  if (!company?.trim())
    throw new BadRequestException('La empresa activa es obligatoria.');
  await manager.query(
    `INSERT INTO jarvis_payroll_settings(company_id,settings,next_number)
      SELECT $1::uuid,$2::jsonb,COALESCE(MAX(number),0)+1
      FROM jarvis_payroll_documents WHERE company_id=$1
      ON CONFLICT(company_id) DO UPDATE SET
        settings=EXCLUDED.settings || jarvis_payroll_settings.settings || jsonb_build_object('prefix',$3::text),
        next_number=GREATEST(jarvis_payroll_settings.next_number,EXCLUDED.next_number),
        updated_at=now()
      WHERE jarvis_payroll_settings.settings->>'prefix' IS DISTINCT FROM $3::text
        OR jarvis_payroll_settings.next_number < EXCLUDED.next_number`,
    [
      company,
      JSON.stringify({
        environment: 2,
        prefix: PAYROLL_PREFIX,
        enabled: false,
      }),
      PAYROLL_PREFIX,
    ],
  );
}
