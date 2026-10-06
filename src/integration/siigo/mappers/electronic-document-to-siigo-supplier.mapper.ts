import { BadRequestException } from '@nestjs/common';
import {
  SIIGO_COMPANY_PERSON_TYPE,
  SIIGO_CONTACT_NAME_MAX_LENGTH,
  SIIGO_DEFAULT_FISCAL_RESPONSIBILITY_CODE,
  SIIGO_DEFAULT_FISCAL_RESPONSIBILITY_NAME,
  SIIGO_SUPPLIER_TYPE,
} from '../constants/siigo.constants';
import {
  ElectronicDocumentPayload,
  ElectronicDocumentSupplier,
} from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import { SiigoSupplierRequestDto } from '../dto/siigo-supplier-request.dto';
import { splitNitAndCheckDigit } from '../helpers/siigo-nit.helper';
import {
  buildSiigoCustomerName,
  resolveSiigoSupplierIdentity,
} from '../helpers/siigo-supplier-identity.helper';

function truncateContactName(value: string): string {
  return value.trim().slice(0, SIIGO_CONTACT_NAME_MAX_LENGTH);
}

/**
 * SIIGO rechaza Address con caracteres no alfanuméricos
 * (`invalid_alphanumeric_value`). Direcciones colombianas suelen traer `#`,
 * `N°`, `°`, etc. Se normalizan a texto que SIIGO acepta.
 */
export function sanitizeSiigoAddress(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return '0000';
  }

  const sanitized = trimmed
    .replace(/n[°ºª]/gi, 'No.')
    .replace(/#/g, 'No.')
    .replace(/[°ºª]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s.,\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || '0000';
}

/** SIIGO solo acepta un correo en contacts[0].email. NextPyme/RUES a
 * veces trae varios separados por coma. */
export function pickFirstSiigoEmail(
  value: string | null | undefined,
): string | undefined {
  const candidates = value
    ?.split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return candidates?.find((candidate) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate),
  );
}

/** SIIGO exige phones[0].number numérico. NextPyme/RUES mezcla `|`, comas
 * y varios números en el mismo campo. */
export function pickFirstSiigoPhone(
  value: string | null | undefined,
): string | undefined {
  const candidates = value
    ?.split(/[|;,/]+/)
    .map((part) => part.replace(/\D/g, ''))
    .filter(Boolean);
  const digits = candidates?.[0];
  if (!digits) {
    return undefined;
  }
  if (digits.startsWith('57') && digits.length === 12) {
    return digits.slice(2);
  }
  if (digits.length >= 7 && digits.length <= 15) {
    return digits;
  }
  return undefined;
}

/** Ciudad propia de la empresa (companies.city_code), usada como default
 * cuando el proveedor no trae ciudad — en vez de un Bogotá fijo sin
 * relación con la empresa que está creando el tercero. */
export interface SiigoSupplierAddressFallback {
  cityCode?: string | null;
  stateCode?: string | null;
}

function resolveStateCodeFromCity(cityCode: string): string {
  // El código DANE de departamento son los primeros 2 dígitos del código de
  // ciudad (ej. 11001 -> 11).
  return cityCode.slice(0, 2) || '11';
}

function normalizeColombianCityCode(value: string, stateCode?: string): string {
  let code = value.trim();
  // Algunas fuentes devuelven departamento + DANE completo: 11 + 11001.
  if (/^\d{7}$/.test(code) && code.slice(0, 2) === code.slice(2, 4)) {
    code = code.slice(2);
  }
  if (/^\d{3}$/.test(code) && stateCode && /^\d{1,2}$/.test(stateCode)) {
    code = stateCode.padStart(2, '0') + code;
  }
  if (/^\d{4}$/.test(code)) code = code.padStart(5, '0');
  if (!/^\d{5}$/.test(code)) {
    throw new BadRequestException('El código de ciudad del tercero para SIIGO debe ser un código DANE de 5 dígitos. Revisa la ciudad del proveedor.');
  }
  return code;
}

function buildAddress(
  supplier: ElectronicDocumentSupplier,
  companyFallback?: SiigoSupplierAddressFallback,
): SiigoSupplierRequestDto['address'] {
  const addressText = supplier.address?.trim();
  const stateCode = supplier.stateCode?.trim();
  const cityCode = supplier.cityCode?.trim();
  const countryCode = supplier.countryCode?.trim();
  const fallbackCityCode = companyFallback?.cityCode?.trim();
  const fallbackStateCode =
    companyFallback?.stateCode?.trim() ||
    (fallbackCityCode ? resolveStateCodeFromCity(fallbackCityCode) : undefined);

  const isColombia = !countryCode || countryCode.toUpperCase() === 'CO';
  const selectedCity = cityCode || fallbackCityCode || '11001';
  const resolvedCity = isColombia
    ? normalizeColombianCityCode(selectedCity, cityCode ? stateCode : fallbackStateCode)
    : selectedCity;

  // SIIGO exige el bloque address para crear terceros. Cuando la DIAN/NextPyme
  // no trae ningún dato de dirección (ej. asociaciones/entidades pequeñas),
  // se envía igual con valores por defecto en vez de omitirlo, porque omitir
  // el campo produce un 400 genérico de SIIGO. La ciudad por defecto es la de
  // la empresa que está creando el tercero (si la configuró un admin);
  // Bogotá queda como último recurso si ni el proveedor ni la empresa la
  // tienen.
  return {
    address: sanitizeSiigoAddress(addressText),
    city: {
      country_code: isColombia ? 'Co' : countryCode!,
      state_code: isColombia ? resolveStateCodeFromCity(resolvedCity) : stateCode || fallbackStateCode || '11',
      city_code: resolvedCity,
    },
  };
}

export function mapElectronicDocumentPayloadToSiigoSupplier(
  payload: ElectronicDocumentPayload,
  personTypeOverride?: string | null,
  companyAddressFallback?: SiigoSupplierAddressFallback,
): SiigoSupplierRequestDto {
  const supplier = payload.supplier;
  const identity = resolveSiigoSupplierIdentity({
    documentType: supplier.documentType,
    personType: personTypeOverride,
  });
  // El dígito de verificación es un concepto exclusivo del NIT (persona
  // jurídica). Para cédulas (persona natural) el número puede tener 10
  // dígitos de forma legítima, así que aplicar el mismo corte truncaba mal
  // el número y generaba un identification distinto al usado en la búsqueda
  // de "¿ya existe?" (que sí usa el número completo).
  const nitParts =
    identity.personType === SIIGO_COMPANY_PERSON_TYPE
      ? splitNitAndCheckDigit(supplier.documentNumber)
      : { identification: '', checkDigit: '' };
  const identification =
    nitParts.identification || supplier.documentNumber.replace(/[^\d]/g, '');

  if (!identification) {
    throw new BadRequestException(
      'El número de documento del proveedor es obligatorio.',
    );
  }

  const name = supplier.name?.trim() || `Proveedor ${identification}`;

  const siigoPayload: SiigoSupplierRequestDto = {
    type: SIIGO_SUPPLIER_TYPE,
    person_type: identity.personType,
    id_type: identity.idType,
    identification,
    name: buildSiigoCustomerName(name, identity.personType),
    // Campo obligatorio en SIIGO. No tenemos el código real de
    // responsabilidad fiscal DIAN del tercero (NextPyme no lo trae), así que
    // se envía el valor neutro "No aplica" en vez de omitirlo.
    fiscal_responsibilities: [
      {
        code: SIIGO_DEFAULT_FISCAL_RESPONSIBILITY_CODE,
        name: SIIGO_DEFAULT_FISCAL_RESPONSIBILITY_NAME,
      },
    ],
  };

  const commercialName = supplier.commercialName?.trim();
  if (commercialName) {
    siigoPayload.commercial_name = commercialName;
  }

  const checkDigit = supplier.checkDigit?.trim() || nitParts.checkDigit;
  if (identity.personType === SIIGO_COMPANY_PERSON_TYPE && checkDigit) {
    siigoPayload.check_digit = checkDigit;
  }

  siigoPayload.address = buildAddress(supplier, companyAddressFallback);

  const phone = pickFirstSiigoPhone(supplier.phone);
  if (phone) {
    siigoPayload.phones = [{ number: phone }];
  }

  const email = pickFirstSiigoEmail(supplier.email);
  if (email) {
    const nameParts = name.split(/\s+/).filter(Boolean);
    siigoPayload.contacts = [
      {
        first_name: truncateContactName(nameParts[0] || name),
        last_name: truncateContactName(nameParts.slice(1).join(' ') || name),
        email,
      },
    ];
  }

  const comments = supplier.comments?.trim();
  if (comments) {
    siigoPayload.comments = comments;
  }

  return siigoPayload;
}
