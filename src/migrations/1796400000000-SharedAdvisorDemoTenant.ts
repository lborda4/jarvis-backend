import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SHARED_DEMO_COMPANY_ID,
  SHARED_DEMO_PLAN_ID,
  SHARED_DEMO_TOKEN,
  SHARED_DEMO_NIT,
} from '../advisor/shared-demo.constants';

export class SharedAdvisorDemoTenant1796400000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE companies ADD COLUMN is_demo boolean NOT NULL DEFAULT false',
    );
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_companies_shared_demo" ON companies (is_demo) WHERE is_demo=true',
    );
    await runner.query(`ALTER TABLE companies ADD CONSTRAINT "CK_shared_demo_no_provider_token"
      CHECK (NOT is_demo OR (id='${SHARED_DEMO_COMPANY_ID}' AND next_pyme_token IS NOT NULL AND next_pyme_token='${SHARED_DEMO_TOKEN}'))`);
    await runner.query(
      `INSERT INTO companies (id,nit,name,invite_code,jarvis_modules,next_pyme_token,city_code,city_name,is_demo)
      VALUES ($1,$2,'Empresa demo Jarvis','DEMO-SHARED-INTERNAL','["BILLING","PAYROLL"]',$3,'11001','Bogotá, D.C.',true)`,
      [SHARED_DEMO_COMPANY_ID, SHARED_DEMO_NIT, SHARED_DEMO_TOKEN],
    );
    // Inactive in the sales catalog; the existing subscription machinery still handles this tenant.
    await runner.query(
      `INSERT INTO plans (id,name,code,provider,document_limit,included_document_types,active)
      VALUES ($1,'Demostración compartida','JARVIS_SHARED_DEMO','JARVIS',NULL,'["SUPPORT_DOCUMENT","PURCHASE_INVOICE"]',false)`,
      [SHARED_DEMO_PLAN_ID],
    );
    const definitions = [
      [
        'electronic_invoice',
        'ELECTRONIC_INVOICE',
        'DEMO',
        'Factura electrónica de venta',
      ],
      [
        'support_document',
        'SUPPORT_DOCUMENT',
        'DEMODS',
        'Documento soporte electrónico',
      ],
      ['credit_note', 'CREDIT_NOTE', 'DEMONC', 'Nota crédito'],
      ['debit_note', 'DEBIT_NOTE', 'DEMOND', 'Nota débito'],
      [
        'support_credit_note',
        'SUPPORT_CREDIT_NOTE',
        'DEMONA',
        'Nota de ajuste al documento soporte electrónico',
      ],
    ];
    const resolutions = Object.fromEntries(
      definitions.map(([key, kind, prefix, documentTypeLabel]) => [
        key,
        {
          kind,
          prefix,
          documentTypeLabel,
          formNumber: 'DEMO-SIN-VALIDEZ',
          fromNumber: 1,
          toNumber: 99999999,
          nextConsecutive: 1,
          dateFrom: '2020-01-01',
          dateTo: '2099-12-31',
          configuredAt: new Date().toISOString(),
          ...(kind === 'ELECTRONIC_INVOICE'
            ? { technicalKey: '0'.repeat(64) }
            : {}),
        },
      ]),
    );
    const credentials = {
      business_name: 'Empresa demo Jarvis',
      trade_name: 'Jarvis Demo',
      economic_activity: '6201',
      tax_regime: 'common',
      vat_regime: 'vat_responsible',
      tax_responsibility: 'R-99-PN',
      country: 'Colombia',
      department: 'Bogotá, D.C.',
      municipality: 'Bogotá, D.C.',
      city: 'Bogotá, D.C.',
      email: 'demo@example.test',
      address: 'Calle 100 # 10-20',
      phone: '3000000000',
      id_software: 'shared-demo-software',
      configured_at: new Date().toISOString(),
      resolutions,
    };
    await runner.query(
      `INSERT INTO integrations (id,company_id,provider,credentials,plan_id,active,subscription_status,subscription_started_at,included_document_types)
      VALUES ('ad000000-0000-4000-8000-000000000003',$1,'JARVIS',$2,$3,true,'ACTIVE',now(),'["SUPPORT_DOCUMENT","PURCHASE_INVOICE"]')`,
      [
        SHARED_DEMO_COMPANY_ID,
        JSON.stringify(credentials),
        SHARED_DEMO_PLAN_ID,
      ],
    );
    await runner.query(
      `INSERT INTO jarvis_payroll_settings(company_id,settings)
      VALUES($1,'{"environment":2,"prefix":"NI","notePrefix":"NA","enabled":true}')`,
      [SHARED_DEMO_COMPANY_ID],
    );
    await runner.query(`CREATE TABLE shared_demo_provider_documents (
      code varchar(96) PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id),
      endpoint varchar(40) NOT NULL, prefix varchar(30) NOT NULL, number varchar(80) NOT NULL,
      payload jsonb NOT NULL, response jsonb NOT NULL, xml text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,endpoint,prefix,number))`);
    // Preserve invoices created by the previous demo in the regular, shared history.
    await runner.query(
      `INSERT INTO jarvis_sales_invoices
      (id,company_id,provider_id,document_kind,prefix,number,issue_date,customer_name,customer_identification,currency,total,cufe,sent_at,source_request)
      SELECT id,$1,id::text,'ELECTRONIC_INVOICE','DEMO',number::text,(created_at AT TIME ZONE 'America/Bogota')::date,
        customer_name,customer_identification,'COP',total,repeat(md5('shared-demo-legacy:'||id::text),3),created_at,
        jsonb_build_object('issueDate',((created_at AT TIME ZONE 'America/Bogota')::date)::text,'customerName',customer_name,
          'customerIdentification',customer_identification,'customerDocumentType','NIT','currency','COP',
          'observations','Demostración sin validez tributaria',
          'emissionSnapshot',jsonb_build_object('issuer',jsonb_build_object('name','Empresa demo Jarvis','documentType','NIT','documentNumber','900000000','email','demo@example.test','cityName','Bogotá, D.C.')),
          'items',jsonb_build_array(jsonb_build_object('description',description,'quantity',quantity,'unitValue',unit_value)))
      FROM advisor_demo_invoices ON CONFLICT DO NOTHING`,
      [SHARED_DEMO_COMPANY_ID],
    );
    await runner.query(
      `UPDATE integrations SET credentials=jsonb_set(credentials,'{resolutions,electronic_invoice,nextConsecutive}',
      to_jsonb((SELECT COALESCE(MAX(number),0)+1 FROM advisor_demo_invoices))) WHERE company_id=$1 AND provider='JARVIS'`,
      [SHARED_DEMO_COMPANY_ID],
    );
  }

  async down(runner: QueryRunner) {
    // Preserve shared business records. A rollback requires explicitly archiving the demo first.
    const [{ count }] = await runner.query(
      `SELECT COUNT(*)::int AS count FROM companies WHERE is_demo=true`,
    );
    if (count)
      throw new Error(
        'Archiva la empresa demo y sus datos antes de revertir esta migración.',
      );
    await runner.query('DROP TABLE shared_demo_provider_documents');
    await runner.query(
      'ALTER TABLE companies DROP CONSTRAINT "CK_shared_demo_no_provider_token"',
    );
    await runner.query('DROP INDEX "UQ_companies_shared_demo"');
    await runner.query('ALTER TABLE companies DROP COLUMN is_demo');
  }
}
