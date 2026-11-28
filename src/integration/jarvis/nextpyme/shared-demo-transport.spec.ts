import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { SharedDemoTransport } from './shared-demo-transport';
import { NextPymeApiClient } from './nextpyme-api.client';
import { NextPymeRutService } from '../nextpyme-rut.service';
import { installSharedDemoTransport } from './shared-demo-http';
import {
  SHARED_DEMO_COMPANY_ID,
  SHARED_DEMO_NIT,
  SHARED_DEMO_TOKEN,
} from '../../../advisor/shared-demo.constants';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';

function setup() {
  const documents = new Map<string, any>();
  const query = jest.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT credentials'))
      return [
        {
          credentials: {
            business_name: 'Empresa demo Jarvis',
            email: 'demo@example.test',
            city: 'Bogotá',
            economic_activity: '6201',
            resolutions: {},
          },
        },
      ];
    if (sql.startsWith('INSERT INTO shared_demo_provider_documents')) {
      const existing = documents.get(args[0]);
      if (existing && JSON.stringify(existing.payload) !== args[5]) return [];
      const row = existing ?? {
        code: args[0],
        company_id: args[1],
        payload: JSON.parse(args[5]),
        response: JSON.parse(args[6]),
        xml: args[7],
      };
      documents.set(args[0], row);
      return [{ response: row.response }];
    }
    if (sql.includes('FROM shared_demo_provider_documents')) {
      const row = documents.get(args[1]);
      return row && row.company_id === args[0] ? [row] : [];
    }
    if (sql.includes('jarvis_radian_events')) return [];
    if (sql.includes('jarvis_terceros')) return [];
    throw new Error('Unexpected query: ' + sql);
  });
  const network = jest.fn(async () => {
    throw new Error('Unexpected outbound network request');
  });
  const http = new HttpService(axios.create({ adapter: network }));
  const transport = new SharedDemoTransport({ query } as never);
  const config = {
    get: (key: string) =>
      ({
        'nextPyme.baseUrl': 'https://provider.invalid/api/ubl2.1',
        'nextPyme.invoiceQueryUrl':
          'https://provider.invalid/api/ubl2.1/return-invoice-data',
        'purchaseInvoiceImport.maxRetries': 0,
        'app.nodeEnv': 'local',
      })[key],
  };
  const api = new NextPymeApiClient(http, config as never, transport);
  return { api, http, transport, query, network, documents, config };
}
const invoice = {
  type_document_id: 1,
  prefix: 'DEMO',
  number: 1,
  date: '2026-11-28',
  customer: {
    name: 'Cliente demo',
    identification_number: '900123456',
    email: 'client@example.test',
  },
  payment_form: { payment_form_id: 2, payment_method_id: 47 },
  legal_monetary_totals: {
    line_extension_amount: '200',
    tax_exclusive_amount: '200',
    tax_inclusive_amount: '238',
    payable_amount: '238',
  },
  tax_totals: [
    { tax_id: 1, tax_amount: '38', taxable_amount: '200', percent: '19' },
  ],
  invoice_lines: [
    {
      description: 'Servicio de demostración',
      code: 'S1',
      invoiced_quantity: 2,
      price_amount: '100',
      line_extension_amount: '200',
      base_quantity: 1,
      tax_totals: [
        { tax_id: 1, tax_amount: '38', taxable_amount: '200', percent: '19' },
      ],
    },
  ],
};

it('persists a demo issue in the shared database and retrieves the same document from a new transport instance', async () => {
  const f = setup();
  const created = await f.api.createInvoice(
    invoice as never,
    SHARED_DEMO_TOKEN,
  );
  expect(created).toMatchObject({
    success: true,
    simulated: true,
    number: '1',
    prefix: 'DEMO',
  });
  expect(f.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO shared_demo_provider_documents'),
    expect.arrayContaining([SHARED_DEMO_COMPANY_ID]),
  );
  const secondHttp = new HttpService(axios.create({ adapter: f.network }));
  const secondApi = new NextPymeApiClient(
    secondHttp,
    f.config as never,
    new SharedDemoTransport({ query: f.query } as never),
  );
  expect(
    await secondApi.getInvoiceXmlByCufe(
      String(created.cufe),
      SHARED_DEMO_TOKEN,
    ),
  ).toContain('Servicio de demostración');
  const pdf = mapInvoiceXmlToPurchaseInvoiceDownload(
    String(created.xml),
    'document',
    String(created.cufe),
  );
  expect(pdf).toMatchObject({
    invoiceNumber: 'DEMO1',
    total: 238,
    subtotal: 200,
    iva: 38,
  });
  expect(pdf.items).toEqual([
    expect.objectContaining({
      quantity: 2,
      unitValue: 100,
      description: 'Servicio de demostración',
    }),
  ]);
  await expect(
    secondApi.getInvoiceByCufe(String(created.cufe), SHARED_DEMO_TOKEN),
  ).resolves.toMatchObject({ outcome: 'found' });
  expect(f.network).not.toHaveBeenCalled();
});

it.each([
  'support-document',
  'credit-note',
  'debit-note',
  'sd-credit-note',
  'payroll',
  'payroll-adjust-note',
])('simulates %s without reaching the provider', async (endpoint) => {
  const f = setup();
  const body = endpoint.startsWith('payroll')
    ? { prefix: 'NI', consecutive: 1, date: '2026-11-28' }
    : invoice;
  const response = await f.http.axiosRef.post(
    'https://provider.invalid/api/ubl2.1/' + endpoint,
    body,
    { headers: { Authorization: `Bearer ${SHARED_DEMO_TOKEN}` } },
  );
  expect(response.data).toMatchObject({
    success: true,
    simulated: true,
    ResponseDian: { IsValid: true },
  });
  if (endpoint.startsWith('payroll'))
    expect(response.data.cune).toMatch(/^[a-f0-9]{96}$/);
  expect(f.network).not.toHaveBeenCalled();
});

it.each(['credit-note', 'debit-note', 'sd-credit-note'])(
  'keeps the regular note payload lines and monetary totals in the %s PDF',
  async (endpoint) => {
    const f = setup();
    const { invoice_lines, legal_monetary_totals, prefix, ...fields } = invoice;
    const debit = endpoint === 'debit-note';
    const response = await f.http.axiosRef.post(
      'https://provider.invalid/api/ubl2.1/' + endpoint,
      {
        ...fields,
        ...(!debit ? { prefix } : {}),
        [debit ? 'requested_monetary_totals' : 'legal_monetary_totals']:
          legal_monetary_totals,
        [debit ? 'debit_note_lines' : 'credit_note_lines']: invoice_lines,
      },
      { headers: { Authorization: `Bearer ${SHARED_DEMO_TOKEN}` } },
    );
    const pdf = mapInvoiceXmlToPurchaseInvoiceDownload(
      response.data.xml,
      'note',
      response.data.cufe,
    );
    expect(pdf.items).toHaveLength(1);
    expect(pdf).toMatchObject({ total: 238, subtotal: 200, iva: 38 });
    expect(f.network).not.toHaveBeenCalled();
  },
);

it('reuses the same persisted result on retry and rejects reusing a consecutive with different values', async () => {
  const f = setup();
  const first = await f.api.createInvoice(invoice as never, SHARED_DEMO_TOKEN);
  expect(
    await f.api.createInvoice(invoice as never, SHARED_DEMO_TOKEN),
  ).toEqual(first);
  await expect(
    f.api.createInvoice(
      {
        ...invoice,
        customer: { ...invoice.customer, name: 'Changed' },
      } as never,
      SHARED_DEMO_TOKEN,
    ),
  ).rejects.toThrow();
  expect(f.documents.size).toBe(1);
  expect(f.network).not.toHaveBeenCalled();
});

it('uses local catalogs, company configuration, quota, RADIAN and email responses', async () => {
  const f = setup();
  expect(
    await f.api.fetchMasterTable('payment_methods', SHARED_DEMO_TOKEN),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 10 })]));
  expect(
    await f.api.getIssuerTaxConfiguration(SHARED_DEMO_TOKEN),
  ).toMatchObject({ identificationNumber: SHARED_DEMO_NIT });
  expect(
    await f.api.getPayrollIssuerConfiguration(SHARED_DEMO_TOKEN),
  ).toMatchObject({
    payrollSoftwareConfigured: true,
    payrollPinConfigured: true,
    payrollEnvironment: 2,
  });
  expect(await f.api.payrollPlanInfo(SHARED_DEMO_TOKEN)).toMatchObject({
    data: { docs_left_absolut: 99999999 },
  });
  expect(
    await f.api.getInvoiceRadianStatus('a'.repeat(96), SHARED_DEMO_TOKEN),
  ).toEqual({ accepted: false, eventCodes: [] });
  expect(
    await f.api.sendRadianEvent(
      {
        event_id: 1,
        type_rejection_id: null,
        document_reference: { cufe: 'a'.repeat(96) },
      },
      SHARED_DEMO_TOKEN,
    ),
  ).toMatchObject({ status: 'sent', dianCode: '00' });
  expect(
    await f.api.sendDocumentEmail(
      { prefix: 'DEMO', number: '1' },
      SHARED_DEMO_TOKEN,
    ),
  ).toMatchObject({ success: true, simulated: true });
  const rut = new NextPymeRutService(f.http, f.config as never, f.transport);
  expect(
    await rut.lookupDocument('NIT' as never, '900123456', SHARED_DEMO_TOKEN),
  ).toMatchObject({ found: false });
  expect(f.network).not.toHaveBeenCalled();
});

it('fails closed for unknown demo endpoints, missing documents and missing simulation wiring', async () => {
  const f = setup();
  await expect(
    f.http.axiosRef.get('https://provider.invalid/api/ubl2.1/new-feature', {
      headers: { Authorization: `Bearer ${SHARED_DEMO_TOKEN}` },
    }),
  ).rejects.toThrow('no está disponible');
  await expect(
    f.api.getInvoiceXmlByCufe('b'.repeat(96), SHARED_DEMO_TOKEN),
  ).rejects.toThrow();
  const unwired = new HttpService(axios.create({ adapter: f.network }));
  installSharedDemoTransport(unwired);
  await expect(
    unwired.axiosRef.get('https://provider.invalid', {
      headers: { Authorization: `Bearer ${SHARED_DEMO_TOKEN}` },
    }),
  ).rejects.toThrow('transporte demo');
  expect(f.network).not.toHaveBeenCalled();
});

it('keeps real-company credentials on the existing transport', async () => {
  const f = setup();
  await expect(
    f.http.axiosRef.get('https://provider.invalid', {
      headers: { Authorization: 'Bearer real-company-token' },
    }),
  ).rejects.toThrow('Unexpected outbound');
  expect(f.network).toHaveBeenCalledTimes(1);
  expect(f.documents.size).toBe(0);
});
