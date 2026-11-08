import { MigrationInterface, QueryRunner } from 'typeorm';

/** El código es de la empresa y se asigna en la misma transacción que el empleado. */
export class AddPayrollWorkerCodes1794600000000 implements MigrationInterface {
  name = 'AddPayrollWorkerCodes1794600000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'LOCK TABLE jarvis_payroll_employees IN SHARE ROW EXCLUSIVE MODE',
    );
    await runner.query(
      'ALTER TABLE jarvis_payroll_employees ADD COLUMN worker_code varchar(64)',
    );
    // Conserva códigos ya guardados. Ante duplicados antiguos, solo el primer
    // empleado conserva el código; los demás reciben uno nuevo.
    await runner.query(`
      WITH candidates AS (
        SELECT id, company_id, btrim(data->>'workerCode') AS code, updated_at
        FROM jarvis_payroll_employees
        WHERE jsonb_typeof(data->'workerCode') = 'string'
          AND length(btrim(data->>'workerCode')) BETWEEN 1 AND 64
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY company_id, code ORDER BY updated_at, id) AS position
        FROM candidates
      )
      UPDATE jarvis_payroll_employees AS employee SET worker_code = ranked.code
      FROM ranked WHERE employee.id = ranked.id AND ranked.position = 1
    `);
    await runner.query(`CREATE UNIQUE INDEX UQ_payroll_employees_company_worker_code
      ON jarvis_payroll_employees(company_id, worker_code)`);
    await runner.query(`CREATE TABLE jarvis_payroll_employee_sequences (
      company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0)
    )`);
    await runner.query(`
      INSERT INTO jarvis_payroll_employee_sequences (company_id, last_number)
      SELECT company_id, max(substring(worker_code from 4)::bigint)
      FROM jarvis_payroll_employees WHERE worker_code ~ '^EMP[0-9]{1,15}$'
      GROUP BY company_id
    `);
    await runner.query(`
      CREATE FUNCTION next_payroll_worker_code(target_company_id uuid)
      RETURNS text LANGUAGE plpgsql AS $$
      DECLARE consecutive bigint; candidate text;
      BEGIN
        LOOP
          INSERT INTO jarvis_payroll_employee_sequences(company_id, last_number)
            VALUES (target_company_id, 1)
            ON CONFLICT (company_id) DO UPDATE
              SET last_number = jarvis_payroll_employee_sequences.last_number + 1
            RETURNING last_number INTO consecutive;
          candidate := 'EMP' || lpad(consecutive::text, greatest(3, length(consecutive::text)), '0');
          IF NOT EXISTS (SELECT 1 FROM jarvis_payroll_employees
            WHERE company_id = target_company_id AND worker_code = candidate)
          THEN RETURN candidate; END IF;
        END LOOP;
      END;
      $$
    `);
    await runner.query(`
      CREATE FUNCTION assign_payroll_worker_code()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE existing_code text;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          -- El cliente no puede cambiar el código de un empleado guardado.
          NEW.worker_code := OLD.worker_code;
        ELSE
          -- Un INSERT ... ON CONFLICT usado para editar no consume consecutivos.
          SELECT worker_code INTO existing_code FROM jarvis_payroll_employees
            WHERE id = NEW.id AND company_id = NEW.company_id;
          NEW.worker_code := existing_code;
        END IF;
        IF NEW.worker_code IS NULL THEN
          NEW.worker_code := next_payroll_worker_code(NEW.company_id);
        END IF;
        NEW.data := jsonb_set(NEW.data, '{workerCode}', to_jsonb(NEW.worker_code), true);
        RETURN NEW;
      END;
      $$
    `);
    await runner.query(`CREATE TRIGGER assign_payroll_worker_code
      BEFORE INSERT OR UPDATE ON jarvis_payroll_employees
      FOR EACH ROW EXECUTE FUNCTION assign_payroll_worker_code()`);
    // Orden estable para completar los empleados que ya estaban registrados.
    await runner.query(`DO $$ DECLARE employee record;
      BEGIN
        FOR employee IN SELECT id FROM jarvis_payroll_employees ORDER BY company_id, updated_at, id
        LOOP
          UPDATE jarvis_payroll_employees SET worker_code = worker_code WHERE id = employee.id;
        END LOOP;
      END;
      $$`);
    await runner.query(
      'ALTER TABLE jarvis_payroll_employees ALTER COLUMN worker_code SET NOT NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TRIGGER assign_payroll_worker_code ON jarvis_payroll_employees',
    );
    await runner.query('DROP FUNCTION assign_payroll_worker_code()');
    await runner.query('DROP FUNCTION next_payroll_worker_code(uuid)');
    await runner.query('DROP TABLE jarvis_payroll_employee_sequences');
    await runner.query(
      'ALTER TABLE jarvis_payroll_employees DROP COLUMN worker_code',
    );
    // Los códigos siguen en data.workerCode y en las solicitudes ya enviadas.
  }
}
