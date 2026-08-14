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

function buildAddress(
  supplier: ElectronicDocumentSupplier,
): SiigoSupplierRequestDto['address'] {
  const addressText = supplier.address?.trim();
  const stateCode = supplier.stateCode?.trim();
  const cityCode = supplier.cityCode?.trim();
  const countryCode = supplier.countryCode?.trim();

  // SIIGO exige el bloque address para crear terceros. Cuando la DIAN/NextPyme
  // no trae ningún dato de dirección (ej. asociaciones/entidades pequeñas),
  // se envía igual con valores por defecto (Bogotá) en vez de omitirlo, porque
  // omitir el campo produce un 400 genérico de SIIGO.
  return {
    address: addressText || 'Sin dirección',
    city: {
      country_code: countryCode || 'Co',
      state_code: stateCode || '11',
      city_code: cityCode || '11001',
    },
  };
}

export function mapElectronicDocumentPayloadToSiigoSupplier(
  payload: ElectronicDocumentPayload,
  personTypeOverride?: string | null,
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

  siigoPayload.address = buildAddress(supplier);

  if (supplier.phone?.trim()) {
    siigoPayload.phones = [{ number: supplier.phone.trim() }];
  }

  const email = supplier.email?.trim();
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
