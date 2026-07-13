import { mapDocumentTypeLabelFromSiigoIdType } from '../helpers/siigo-supplier-identity.helper';
import { CreateSiigoSupplierResponseSupplierDto } from '../dto/create-siigo-supplier-response.dto';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import { SiigoCustomer } from '../interfaces/siigo-api.interface';
import { getSiigoSupplierName } from '../helpers/siigo-supplier.helper';

export function mapSiigoCustomerToCreatedSupplierResponse(
  customer: SiigoCustomer,
  payload: ElectronicDocumentPayload,
): CreateSiigoSupplierResponseSupplierDto {
  const documentType =
    mapDocumentTypeLabelFromSiigoIdType(customer.id_type) ||
    payload.supplier.documentType ||
    'NIT';

  return {
    id: customer.id,
    name: getSiigoSupplierName(customer),
    documentType,
    documentNumber: customer.identification,
    email:
      customer.contacts?.find((contact) => contact.email?.trim())?.email?.trim() ||
      payload.supplier.email?.trim() ||
      '',
    phone:
      customer.phones?.find((phone) => phone.number?.trim())?.number?.trim() ||
      payload.supplier.phone?.trim() ||
      '',
    address:
      customer.address?.address?.trim() ||
      payload.supplier.address?.trim() ||
      '',
  };
}
