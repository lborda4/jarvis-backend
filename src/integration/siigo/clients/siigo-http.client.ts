import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  SIIGO_API_BASE_URL,
  SIIGO_AUTH_PATH,
  SIIGO_CUSTOMERS_PATH,
  SIIGO_DOCUMENT_TYPES_PATH,
  SIIGO_PURCHASES_PATH,
  SIIGO_PURCHASE_SUPPORT_DOCUMENTS_PATH,
  SIIGO_PAYMENT_TYPES_PATH,
  SIIGO_TAXES_PATH,
  SIIGO_COST_CENTERS_PATH,
  SIIGO_TEST_BALANCE_PATH,
} from '../constants/siigo.constants';
import { SiigoAuthRequestDto } from '../dto/siigo-auth-request.dto';
import { SiigoPurchaseRequestDto } from '../dto/siigo-purchase-request.dto';
import { SiigoSupplierRequestDto } from '../dto/siigo-supplier-request.dto';
import { SiigoSupportDocumentRequestDto } from '../dto/siigo-support-document-request.dto';
import { formatAuthorizationHeader } from '../helpers/siigo-auth.helper';
import {
  SiigoAuthResponse,
  SiigoCustomer,
  SiigoCustomersListResponse,
  SiigoCostCenter,
  SiigoDocumentType,
  SiigoPaymentType,
  SiigoPurchaseResponse,
  SiigoSupportDocumentResponse,
  SiigoTax,
  SiigoTestBalanceReportRequest,
  SiigoTestBalanceReportResponse,
} from '../interfaces/siigo-api.interface';

@Injectable()
export class SiigoHttpClient {
  constructor(private readonly httpService: HttpService) {}

  async authenticate(payload: SiigoAuthRequestDto): Promise<SiigoAuthResponse> {
    console.log('[SIIGO HTTP] POST /auth', {
      username: payload.username,
      hasAccessKey: Boolean(payload.access_key),
    });

    return this.request<SiigoAuthResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_AUTH_PATH}`,
      headers: {
        'Content-Type': 'application/json',
      },
      data: payload,
    });
  }

  async findCustomerByIdentificationAndBranch(
    accessToken: string,
    identification: string,
    branchOffice = 0,
    partnerId?: string,
  ): Promise<SiigoCustomer | null> {
    console.log('[SIIGO HTTP] findCustomerByIdentificationAndBranch - params', {
      identification,
      branchOffice,
      hasPartnerId: Boolean(partnerId),
    });

    const response = await this.request<SiigoCustomersListResponse>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_CUSTOMERS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        identification,
        branch_office: branchOffice,
      },
    });

    const customer = response.results?.[0] ?? null;

    console.log('[SIIGO HTTP] findCustomerByIdentificationAndBranch - response', {
      identification,
      branchOffice,
      resultsCount: response.results?.length ?? 0,
      found: Boolean(customer),
      customerId: customer?.id,
      customerIdentification: customer?.identification,
      customerCommercialName: customer?.commercial_name,
    });

    return customer;
  }

  async createCustomer(
    accessToken: string,
    payload: SiigoSupplierRequestDto,
    partnerId?: string,
  ): Promise<SiigoCustomer> {
    return this.request<SiigoCustomer>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_CUSTOMERS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async createPurchase(
    accessToken: string,
    payload: SiigoPurchaseRequestDto,
    partnerId?: string,
  ): Promise<SiigoPurchaseResponse> {
    console.log('[SIIGO purchase] ===== body POST /v1/purchases =====');
    console.log('[SIIGO purchase] document:', JSON.stringify(payload.document, null, 2));
    console.log('[SIIGO purchase] date:', payload.date);
    console.log('[SIIGO purchase] supplier:', JSON.stringify(payload.supplier, null, 2));
    if (payload.cost_center !== undefined) {
      console.log('[SIIGO purchase] cost_center:', payload.cost_center);
    }
    console.log(
      '[SIIGO purchase] provider_invoice:',
      JSON.stringify(payload.provider_invoice, null, 2),
    );
    console.log('[SIIGO purchase] observations:', payload.observations ?? null);
    console.log('[SIIGO purchase] items:', JSON.stringify(payload.items, null, 2));
    console.log(
      '[SIIGO purchase] payments:',
      JSON.stringify(payload.payments, null, 2),
    );
    console.log('[SIIGO purchase] body completo:', JSON.stringify(payload, null, 2));
    console.log('[SIIGO purchase] ====================================');

    return this.request<SiigoPurchaseResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async createSupportDocument(
    accessToken: string,
    payload: SiigoSupportDocumentRequestDto,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentResponse> {
    console.log(
      '[SIIGO support-document] ===== body POST /v1/purchase-support-documents =====',
    );
    console.log('[SIIGO support-document] supplier:', JSON.stringify(payload.supplier, null, 2));
    if (payload.cost_center !== undefined) {
      console.log('[SIIGO support-document] cost_center:', payload.cost_center);
    }
    console.log(
      '[SIIGO support-document] body completo:',
      JSON.stringify(payload, null, 2),
    );
    console.log(
      '[SIIGO support-document] ====================================',
    );

    return this.request<SiigoSupportDocumentResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASE_SUPPORT_DOCUMENTS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async listDocumentTypes(
    accessToken: string,
    type: string,
    partnerId?: string,
  ): Promise<SiigoDocumentType[]> {
    const response = await this.request<SiigoDocumentType[] | { results?: SiigoDocumentType[] }>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_DOCUMENT_TYPES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        type,
      },
    });

    if (Array.isArray(response)) {
      return response;
    }

    return Array.isArray(response.results) ? response.results : [];
  }

  async listPaymentTypes(
    accessToken: string,
    documentType: string,
    partnerId?: string,
  ): Promise<SiigoPaymentType[]> {
    const response = await this.request<SiigoPaymentType[]>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PAYMENT_TYPES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        document_type: documentType,
      },
    });

    return Array.isArray(response) ? response : [];
  }

  async listTaxes(
    accessToken: string,
    partnerId?: string,
  ): Promise<SiigoTax[]> {
    const response = await this.request<SiigoTax[]>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_TAXES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
    });

    return Array.isArray(response) ? response : [];
  }

  async listCostCenters(
    accessToken: string,
    partnerId?: string,
  ): Promise<SiigoCostCenter[]> {
    const response = await this.request<SiigoCostCenter[]>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_COST_CENTERS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
    });

    return Array.isArray(response) ? response : [];
  }

  async createTestBalanceReport(
    accessToken: string,
    payload: SiigoTestBalanceReportRequest,
    partnerId?: string,
  ): Promise<SiigoTestBalanceReportResponse> {
    return this.request<SiigoTestBalanceReportResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_TEST_BALANCE_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async downloadExternalFile(fileUrl: string): Promise<Buffer> {
    const response = await firstValueFrom(
      this.httpService.get(fileUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      }),
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `No se pudo descargar el archivo Excel desde SIIGO (estado ${response.status}).`,
      );
    }

    return Buffer.from(response.data);
  }

  private buildAuthHeaders(
    accessToken: string,
    partnerId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: formatAuthorizationHeader(accessToken),
      'Content-Type': 'application/json',
    };

    if (partnerId) {
      headers['Partner-Id'] = partnerId;
      headers['Partner-ID'] = partnerId;
    }

    return headers;
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    console.log('[SIIGO HTTP] ANTES request', {
      method: config.method,
      url: config.url,
      params: config.params,
    });

    if (config.data !== undefined) {
      console.log('[SIIGO HTTP] request body');
      console.log(
        typeof config.data === 'string'
          ? config.data
          : JSON.stringify(config.data, null, 2),
      );
    }

    const response = await firstValueFrom(
      this.httpService.request<T>({
        validateStatus: () => true,
        ...config,
      }),
    );

    const responsePreview =
      typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : String(response.data);

    console.log('[SIIGO HTTP] DESPUÉS request', {
      method: config.method,
      url: config.url,
      status: response.status,
      bodyPreview: responsePreview.slice(0, 2000),
    });

    if (response.status < 200 || response.status >= 300) {
      const errorBody =
        typeof response.data === 'object'
          ? JSON.stringify(response.data)
          : String(response.data);

      console.error('[SIIGO HTTP] error response', {
        method: config.method,
        url: config.url,
        status: response.status,
        requestBody:
          config.data !== undefined
            ? JSON.stringify(config.data, null, 2)
            : null,
        responseBody: response.data ?? errorBody,
      });

      throw new Error(
        `SIIGO respondió con estado ${response.status}: ${errorBody}`,
      );
    }

    return response.data;
  }
}
