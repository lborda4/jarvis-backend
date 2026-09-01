import { Injectable, Logger } from '@nestjs/common';
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
  SIIGO_PRODUCTS_PATH,
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
  SiigoProductsListResponse,
  SiigoPurchaseResponse,
  SiigoPurchasesListResponse,
  SiigoSupportDocumentDeleteResponse,
  SiigoSupportDocumentResponse,
  SiigoTax,
  SiigoTestBalanceReportRequest,
  SiigoTestBalanceReportResponse,
} from '../interfaces/siigo-api.interface';

const LOG_BODY_PREVIEW_LIMIT = 2000;

@Injectable()
export class SiigoHttpClient {
  private readonly logger = new Logger(SiigoHttpClient.name);

  constructor(private readonly httpService: HttpService) {}

  async authenticate(payload: SiigoAuthRequestDto): Promise<SiigoAuthResponse> {
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
    const response = await this.request<SiigoCustomersListResponse>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_CUSTOMERS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        identification,
        branch_office: branchOffice,
      },
    });

    return response.results?.[0] ?? null;
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
    return this.request<SiigoPurchaseResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async listPurchases(
    accessToken: string,
    page: number,
    pageSize: number,
    partnerId?: string,
  ): Promise<SiigoPurchasesListResponse> {
    return this.request<SiigoPurchasesListResponse>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASES_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        page,
        page_size: pageSize,
      },
    });
  }

  async deletePurchase(
    accessToken: string,
    siigoPurchaseId: string,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentDeleteResponse> {
    return this.request<SiigoSupportDocumentDeleteResponse>({
      method: 'DELETE',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASES_PATH}/${encodeURIComponent(siigoPurchaseId)}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
    });
  }

  async createSupportDocument(
    accessToken: string,
    payload: SiigoSupportDocumentRequestDto,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentResponse> {
    return this.request<SiigoSupportDocumentResponse>({
      method: 'POST',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASE_SUPPORT_DOCUMENTS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      data: payload,
    });
  }

  async deleteSupportDocument(
    accessToken: string,
    siigoSupportDocumentId: string,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentDeleteResponse> {
    return this.request<SiigoSupportDocumentDeleteResponse>({
      method: 'DELETE',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PURCHASE_SUPPORT_DOCUMENTS_PATH}/${encodeURIComponent(siigoSupportDocumentId)}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
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

  async listProducts(
    accessToken: string,
    page: number,
    pageSize: number,
    partnerId?: string,
  ): Promise<SiigoProductsListResponse> {
    return this.request<SiigoProductsListResponse>({
      method: 'GET',
      url: `${SIIGO_API_BASE_URL}${SIIGO_PRODUCTS_PATH}`,
      headers: this.buildAuthHeaders(accessToken, partnerId),
      params: {
        page,
        page_size: pageSize,
      },
    });
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
    const requestPreview = this.preview(config.data);

    this.logger.debug(
      `[SIIGO HTTP] ${config.method} ${config.url}${
        requestPreview ? ` body=${requestPreview}` : ''
      }`,
    );

    const response = await firstValueFrom(
      this.httpService.request<T>({
        validateStatus: () => true,
        ...config,
      }),
    );

    if (response.status < 200 || response.status >= 300) {
      const errorBody = this.preview(response.data);

      this.logger.error(
        `[SIIGO HTTP] ${config.method} ${config.url} respondió con estado ${response.status}: ${errorBody}` +
          (requestPreview ? ` | body enviado=${requestPreview}` : ''),
      );

      throw new Error(
        `SIIGO respondió con estado ${response.status}: ${errorBody}`,
      );
    }

    this.logger.debug(
      `[SIIGO HTTP] ${config.method} ${config.url} -> ${response.status} ${this.preview(response.data)}`,
    );

    return response.data;
  }

  private preview(value: unknown): string {
    if (value === undefined) {
      return '';
    }

    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);

    return serialized.length > LOG_BODY_PREVIEW_LIMIT
      ? `${serialized.slice(0, LOG_BODY_PREVIEW_LIMIT)}… (${serialized.length} chars)`
      : serialized;
  }
}
