import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { XMLBuilder } from 'fast-xml-parser';
import {
  SHARED_DEMO_COMPANY_ID,
  SHARED_DEMO_NIT,
} from '../../../advisor/shared-demo.constants';
import { sharedDemoCatalogs } from './shared-demo-catalogs';

type RecordValue = Record<string, any>;
const valid = {
  IsValid: true,
  StatusCode: '00',
  StatusDescription: 'Demostración sin validez tributaria',
};
const idFor = (value: unknown) =>
  createHash('sha384').update(JSON.stringify(value)).digest('hex');
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

/** Replaces only the provider transport. Existing services persist normal tenant records in PostgreSQL. */
@Injectable()
export class SharedDemoTransport {
  constructor(private readonly db: DataSource) {}

  async respond(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const path = new URL(
      config.url!,
      config.baseURL || 'https://demo.invalid',
    ).pathname
      .replace(/^.*\/ubl2\.1\//, '')
      .replace(/^\/+/, '');
    const body =
      typeof config.data === 'string' && config.data.trim()
        ? JSON.parse(config.data)
        : record(config.data);
    const data = await this.handle(
      path,
      (config.method ?? 'get').toUpperCase(),
      body,
    );
    return {
      data,
      status: 200,
      statusText: 'OK (demo)',
      headers: {
        'content-type': Buffer.isBuffer(data)
          ? 'application/octet-stream'
          : 'application/json',
      },
      config,
    };
  }

  private async credentials() {
    const [row] = await this.db.query(
      "SELECT credentials FROM integrations WHERE company_id=$1 AND provider='JARVIS'",
      [SHARED_DEMO_COMPANY_ID],
    );
    if (!row)
      throw new NotFoundException(
        'La configuración de la empresa demo no está disponible.',
      );
    return record(row.credentials);
  }

  private async resolutions() {
    const credentials = await this.credentials();
    const types = {
      ELECTRONIC_INVOICE: 1,
      CREDIT_NOTE: 4,
      DEBIT_NOTE: 5,
      SUPPORT_DOCUMENT: 11,
      SUPPORT_CREDIT_NOTE: 13,
    };
    return [
      ...Object.values(record(credentials.resolutions)).map(
        (value: RecordValue, index) => ({
          id: index + 1,
          type_document_id: types[value.kind],
          prefix: value.prefix,
          from: value.fromNumber,
          to: value.toNumber,
          number: value.nextConsecutive ?? value.fromNumber,
          next_consecutive: String(value.nextConsecutive ?? value.fromNumber),
          resolution: value.formNumber,
          resolution_date: value.dateFrom,
          date_from: value.dateFrom,
          date_to: value.dateTo,
          technical_key: value.technicalKey,
          type_document: {
            id: types[value.kind],
            name: value.documentTypeLabel,
          },
        }),
      ),
      ...[9, 10].map((type, index) => ({
        id: 100 + index,
        type_document_id: type,
        prefix: index ? 'NA' : 'NI',
        from: 1,
        to: 99999999,
        number: 1,
      })),
    ];
  }

  private async handle(
    path: string,
    method: string,
    body: RecordValue,
  ): Promise<unknown> {
    if (path.endsWith('reports/master/database')) {
      const table = body.tables?.[0]?.table;
      const rows = sharedDemoCatalogs[table];
      if (!rows)
        throw new BadRequestException(
          `El catálogo ${String(table)} no está disponible en la demo.`,
        );
      return { data: rows };
    }
    if (path.endsWith('config/company')) {
      const credentials = await this.credentials();
      return {
        success: true,
        data: {
          identification_number: SHARED_DEMO_NIT,
          type_regime_id:
            credentials.vat_regime === 'non_vat_responsible' ? 2 : 1,
          ciiu: credentials.economic_activity,
          payroll_type_environment_id: 2,
          software: { identifier_payroll: 'shared-demo', pin_payroll: 'demo' },
        },
      };
    }
    if (
      path.endsWith('reports/resolutions') ||
      path.endsWith('numbering-range')
    )
      return { success: true, data: await this.resolutions() };
    if (
      path.endsWith('config/resolution') ||
      path.endsWith('config/environment') ||
      path.endsWith('config/logo')
    )
      return { success: true, data: body };
    if (/certificates-listing\/[^/]+$/.test(path))
      return {
        success: true,
        certificates: [
          { expiration_date: `${new Date().getFullYear() + 1}-12-31 23:59:59` },
        ],
      };
    if (
      path.endsWith('plan/infoplanuser') ||
      path.endsWith('plan/assign-package-user')
    )
      return { success: true, data: { docs_left_absolut: 99999999 } };
    if (path.endsWith('rut-rues')) {
      const [row] = await this.db.query(
        'SELECT name,email,phone,address FROM jarvis_terceros WHERE company_id=$1 AND document_number=$2',
        [SHARED_DEMO_COMPANY_ID, String(body.identification_number)],
      );
      return row
        ? {
            success: true,
            data: {
              ...row,
              identification_number: String(body.identification_number),
            },
          }
        : {
            success: false,
            message: 'Documento no registrado en la empresa demo',
          };
    }
    if (path.endsWith('send-email'))
      return {
        success: true,
        simulated: true,
        message: 'Correo simulado en la empresa demo',
      };
    if (path.endsWith('send-event-data'))
      return this.issue('radian', {
        ...body,
        prefix: 'EVENT',
        number: idFor([body.document_reference, body.event_id]).slice(0, 64),
      });
    if (/status\/events-document\//.test(path)) {
      const cufe = path.split('/').at(-1);
      const rows = await this.db.query(
        'SELECT event_id FROM jarvis_radian_events WHERE company_id=$1 AND cufe=$2 AND status=$3',
        [SHARED_DEMO_COMPANY_ID, cufe, 'sent'],
      );
      return {
        success: true,
        events: rows.map((row: RecordValue) => ({
          event_id: row.event_id,
          dian_code: { 1: '030', 2: '031', 3: '032', 4: '033' }[row.event_id],
          status: 'sent',
        })),
      };
    }
    if (/status\/document\//.test(path))
      return this.document(path.split('/').at(-1)!).then((row) => row.response);
    if (/xml\/document\//.test(path))
      return this.document(path.split('/').at(-1)!).then((row) => ({
        xml: row.xml,
      }));
    if (path.endsWith('return-invoice-data')) {
      const [row] = await this.db.query(
        'SELECT payload,code FROM shared_demo_provider_documents WHERE company_id=$1 AND code=$2',
        [SHARED_DEMO_COMPANY_ID, body.qr_cufe],
      );
      if (!row) return { success: false, data: null };
      return {
        success: true,
        data: {
          ...row.payload,
          uuid: row.code,
          seller: row.payload.seller ?? (await this.issuer()),
        },
      };
    }
    if (/download\//.test(path)) return this.download(path.split('/').at(-1)!);
    const endpoint = path.split('/').at(-1)!;
    if (
      [
        'invoice',
        'support-document',
        'credit-note',
        'debit-note',
        'sd-credit-note',
        'payroll',
        'payroll-adjust-note',
      ].includes(endpoint) &&
      ['POST', 'PUT'].includes(method)
    )
      return this.issue(endpoint, body);
    // Unknown operations fail locally; a demo request never falls back to the network.
    throw new BadRequestException(
      `Esta operación del proveedor no está disponible en la demo (${path}).`,
    );
  }

  private async issuer() {
    const credentials = await this.credentials();
    return {
      name: credentials.business_name,
      identification_number: SHARED_DEMO_NIT,
      type_document_identification_id: 6,
      email: credentials.email,
      address: credentials.address,
      phone: credentials.phone,
      municipality: { name: credentials.city },
    };
  }

  private async document(code: string) {
    const [row] = await this.db.query(
      'SELECT * FROM shared_demo_provider_documents WHERE company_id=$1 AND code=$2',
      [SHARED_DEMO_COMPANY_ID, code],
    );
    if (!row)
      throw new NotFoundException(
        'No se encontró el documento en la empresa demo.',
      );
    return row;
  }

  private async issue(endpoint: string, body: RecordValue) {
    const sequence = record(body.numbering_range);
    const credentials = await this.credentials();
    const resolutionKey = {
      invoice: 'electronic_invoice',
      'support-document': 'support_document',
      'credit-note': 'credit_note',
      'debit-note': 'debit_note',
      'sd-credit-note': 'support_credit_note',
    }[endpoint];
    const configuredPrefix =
      credentials.resolutions?.[resolutionKey ?? '']?.prefix;
    const prefix = String(
      body.prefix ??
        sequence.prefix ??
        configuredPrefix ??
        (endpoint === 'payroll-adjust-note'
          ? 'NA'
          : endpoint === 'payroll'
            ? 'NI'
            : 'DEMO'),
    );
    const number = String(
      body.number ??
        body.consecutive ??
        sequence.consecutive ??
        sequence.number ??
        '',
    );
    if (!number || number.length > 80)
      throw new BadRequestException(
        'El documento demo requiere un consecutivo válido.',
      );
    const code = idFor([SHARED_DEMO_COMPANY_ID, endpoint, prefix, number]);
    const payroll = endpoint.startsWith('payroll');
    const xml = await this.xml(body, code, endpoint, prefix, number);
    const response = {
      success: true,
      simulated: true,
      id: code,
      uuid: code,
      cufe: code,
      cude: code,
      cune: code,
      number,
      prefix,
      consecutive: prefix + number,
      xml,
      ResponseDian: valid,
      ...(payroll ? { pdf: `${code}.pdf`, xmlFile: `${code}.xml` } : {}),
      message: 'Demostración sin validez tributaria',
    };
    const stored = await this.db.query(
      `INSERT INTO shared_demo_provider_documents (code,company_id,endpoint,prefix,number,payload,response,xml)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code
      WHERE shared_demo_provider_documents.payload=EXCLUDED.payload RETURNING response`,
      [
        code,
        SHARED_DEMO_COMPANY_ID,
        endpoint,
        prefix,
        number,
        JSON.stringify(body),
        JSON.stringify(response),
        xml,
      ],
    );
    if (!stored.length)
      throw new ConflictException(
        'El consecutivo demo ya se utilizó con otros datos.',
      );
    return stored[0].response;
  }

  private async xml(
    body: RecordValue,
    code: string,
    endpoint: string,
    prefix: string,
    number: string,
  ) {
    const issuer = await this.issuer();
    const support =
      endpoint === 'support-document' || endpoint === 'sd-credit-note';
    const supplier = support ? record(body.seller) : issuer;
    const buyer = support ? issuer : record(body.customer);
    const party = (person: RecordValue) => ({
      'cac:Party': {
        'cac:PartyName': { 'cbc:Name': person.name },
        'cac:PartyTaxScheme': {
          'cbc:RegistrationName': person.name,
          'cbc:CompanyID': {
            '#text': person.identification_number,
            '@_schemeName': '31',
          },
          'cac:TaxScheme': { 'cbc:ID': '01', 'cbc:Name': 'IVA' },
        },
        'cac:PhysicalLocation': {
          'cac:Address': {
            'cbc:CityName': 'Bogotá, D.C.',
            'cac:AddressLine': { 'cbc:Line': person.address },
          },
        },
        'cac:Contact': {
          'cbc:ElectronicMail': person.email,
          'cbc:Telephone': person.phone,
        },
      },
    });
    const tax = (value: RecordValue) => ({
      'cbc:TaxAmount': value.tax_amount,
      'cac:TaxSubtotal': {
        'cbc:TaxableAmount': value.taxable_amount,
        'cbc:TaxAmount': value.tax_amount,
        'cac:TaxCategory': {
          'cbc:Percent': value.percent,
          'cac:TaxScheme': {
            'cbc:ID': String(value.tax_id ?? 1).padStart(2, '0'),
            'cbc:Name': 'IVA',
          },
        },
      },
    });
    const root =
      endpoint === 'credit-note' || endpoint === 'sd-credit-note'
        ? 'CreditNote'
        : endpoint === 'debit-note'
          ? 'DebitNote'
          : 'Invoice';
    const lineName =
      root === 'CreditNote'
        ? 'CreditNoteLine'
        : root === 'DebitNote'
          ? 'DebitNoteLine'
          : 'InvoiceLine';
    const quantityName =
      root === 'CreditNote'
        ? 'CreditedQuantity'
        : root === 'DebitNote'
          ? 'DebitedQuantity'
          : 'InvoicedQuantity';
    const totals = record(
      body.legal_monetary_totals ?? body.requested_monetary_totals,
    );
    const lines =
      body.invoice_lines ??
      body.credit_note_lines ??
      body.debit_note_lines ??
      [];
    const allowance = (value: RecordValue) => ({
      'cbc:ChargeIndicator': value.charge_indicator ?? false,
      'cbc:AllowanceChargeReason': value.allowance_charge_reason ?? 'Descuento',
      'cbc:Amount': value.amount,
      'cbc:BaseAmount': value.base_amount,
    });
    const document = {
      '@_xmlns': `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`,
      '@_xmlns:cbc':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      '@_xmlns:cac':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'cbc:UBLVersionID': 'UBL 2.1',
      'cbc:ID': prefix + number,
      'cbc:UUID': code,
      'cbc:IssueDate': body.date ?? new Date().toISOString().slice(0, 10),
      'cbc:Note':
        'DEMOSTRACIÓN SIN VALIDEZ TRIBUTARIA. ' + String(body.notes ?? ''),
      'cbc:DocumentCurrencyCode':
        sharedDemoCatalogs.type_currencies.find(
          (row) => row.id === Number(body.type_currency_id),
        )?.code ?? 'COP',
      'cac:AccountingSupplierParty': party(supplier),
      'cac:AccountingCustomerParty': party(buyer),
      'cac:PaymentMeans': {
        'cbc:ID': body.payment_form?.payment_form_id ?? 1,
        'cbc:PaymentMeansCode': body.payment_form?.payment_method_id ?? 10,
      },
      'cac:TaxTotal': (body.tax_totals ?? []).map(tax),
      'cac:AllowanceCharge': (body.allowance_charges ?? []).map(allowance),
      'cac:WithholdingTaxTotal': (
        body.with_holding_tax_total ??
        body.with_holding_tax_totals ??
        []
      ).map(tax),
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': totals.line_extension_amount ?? '0',
        'cbc:TaxExclusiveAmount': totals.tax_exclusive_amount ?? '0',
        'cbc:TaxInclusiveAmount': totals.tax_inclusive_amount ?? '0',
        'cbc:PayableAmount': totals.payable_amount ?? '0',
        'cbc:AllowanceTotalAmount': totals.allowance_total_amount ?? '0',
      },
      [`cac:${lineName}`]: lines.map((line: RecordValue, index: number) => ({
        'cbc:ID': index + 1,
        [`cbc:${quantityName}`]: line.invoiced_quantity,
        'cbc:LineExtensionAmount': line.line_extension_amount,
        'cac:Item': {
          'cbc:Description': line.description,
          'cac:SellersItemIdentification': { 'cbc:ID': line.code },
        },
        'cac:Price': {
          'cbc:PriceAmount': line.price_amount,
          'cbc:BaseQuantity': line.base_quantity ?? 1,
        },
        'cac:TaxTotal': (line.tax_totals ?? []).map(tax),
        'cac:AllowanceCharge': (line.allowance_charges ?? []).map(allowance),
      })),
    };
    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      new XMLBuilder({ ignoreAttributes: false }).build({ [root]: document })
    );
  }

  private async download(filename: string) {
    const match = /^([a-f0-9]{96})\.(pdf|xml)$/i.exec(
      decodeURIComponent(filename),
    );
    if (!match) throw new NotFoundException('Archivo demo no encontrado.');
    const row = await this.document(match[1]);
    if (match[2] === 'xml') return Buffer.from(row.xml);
    const [detail] = await this.db.query(
      'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND cune=$2',
      [SHARED_DEMO_COMPANY_ID, match[1]],
    );
    if (!detail) throw new NotFoundException('No se encontró la nómina demo.');
    const { generatePayrollPayslip } =
      await import('../../../payroll/payroll-payslip-pdf.js');
    return generatePayrollPayslip({
      detail,
      company: {
        name: 'Empresa demo Jarvis',
        nit: SHARED_DEMO_NIT,
        isDemo: true,
      },
    });
  }
}
