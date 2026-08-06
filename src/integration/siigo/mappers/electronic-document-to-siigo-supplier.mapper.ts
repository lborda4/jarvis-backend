import { BadRequestException } from '@nestjs/common';
import {
  SIIGO_COMPANY_PERSON_TYPE,
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

function buildOptionalAddress(
  supplier: ElectronicDocumentSupplier,
): SiigoSupplierRequestDto['address'] | undefined {
  const addressText = supplier.address?.trim();
  const stateCode = supplier.stateCode?.trim();
  const cityCode = supplier.cityCode?.trim();
  const countryCode = supplier.countryCode?.trim();

  if (!addressText && !stateCode && !cityCode && !countryCode) {
    return undefined;
  }

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
  const nitParts = splitNitAndCheckDigit(supplier.documentNumber);
  const identification =
    nitParts.identification || supplier.documentNumber.replace(/[^\d]/g, '');
  const name = supplier.name?.trim();

  if (!identification) {
    throw new BadRequestException(
      'El número de documento del proveedor es obligatorio.',
    );
  }

  if (!name) {
    throw new BadRequestException('El nombre del proveedor es obligatorio.');
  }

  const siigoPayload: SiigoSupplierRequestDto = {
    type: SIIGO_SUPPLIER_TYPE,
    person_type: identity.personType,
    id_type: identity.idType,
    identification,
    name: buildSiigoCustomerName(name, identity.personType),
  };

  const commercialName = supplier.commercialName?.trim();
  if (commercialName) {
    siigoPayload.commercial_name = commercialName;
  }

  const checkDigit = supplier.checkDigit?.trim() || nitParts.checkDigit;
  if (identity.personType === SIIGO_COMPANY_PERSON_TYPE && checkDigit) {
    siigoPayload.check_digit = checkDigit;
  }

  const address = buildOptionalAddress(supplier);
  if (address) {
    siigoPayload.address = address;
  }

  if (supplier.phone?.trim()) {
    siigoPayload.phones = [{ number: supplier.phone.trim() }];
  }

  const email = supplier.email?.trim();
  if (email) {
    siigoPayload.contacts = [
      {
        first_name: name.split(/\s+/).filter(Boolean)[0] || name,
        last_name: name.split(/\s+/).filter(Boolean).slice(1).join(' ') || name,
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
