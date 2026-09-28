/** Synthetic invoice: no real credentials or customer data. */
export const DOWNLOAD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:cbc" xmlns:cac="urn:cac" xmlns:ext="urn:ext" xmlns:sts="urn:sts">
<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><sts:DianExtensions>
<sts:InvoiceControl><sts:AuthorizedInvoices><sts:Prefix>XML</sts:Prefix></sts:AuthorizedInvoices></sts:InvoiceControl>
<sts:QRCode>CUFE: cufe-123
https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=cufe-123&amp;test=1</sts:QRCode>
</sts:DianExtensions></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
<cbc:ID>XML1</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">cufe-123</cbc:UUID>
<cbc:IssueDate>2026-09-01</cbc:IssueDate><cbc:IssueTime>09:12:00-05:00</cbc:IssueTime><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
<cbc:Note>Primera nota</cbc:Note><cbc:Note>Segunda nota</cbc:Note>
<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Proveedor XML</cbc:RegistrationName><cbc:CompanyID schemeName="31" schemeID="5">001234567</cbc:CompanyID></cac:PartyTaxScheme>
<cac:PhysicalLocation><cac:Address><cbc:CityName>Bogota</cbc:CityName><cac:AddressLine><cbc:Line>Calle 1</cbc:Line></cac:AddressLine><cac:Country><cbc:Name>Colombia</cbc:Name></cac:Country></cac:Address></cac:PhysicalLocation>
<cac:Contact><cbc:ElectronicMail>invoice@example.test</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Comprador XML</cbc:RegistrationName><cbc:CompanyID schemeName="31">900123456</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cbc:ID>2</cbc:ID><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-10-01</cbc:PaymentDueDate></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount>38</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxAmount>38</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:WithholdingTaxTotal><cac:TaxSubtotal><cbc:TaxAmount>5</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>2.5</cbc:Percent><cac:TaxScheme><cbc:ID>06</cbc:ID><cbc:Name>ReteFuente</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">200</cbc:LineExtensionAmount><cbc:AllowanceTotalAmount>0</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="COP">238</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="EA">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount>200</cbc:LineExtensionAmount>
<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount>10</cbc:Amount></cac:AllowanceCharge>
<cac:TaxTotal><cac:TaxSubtotal><cbc:TaxAmount>38</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:Item><cbc:Description>Producto original</cbc:Description><cac:SellersItemIdentification><cbc:ID>00012</cbc:ID></cac:SellersItemIdentification></cac:Item><cac:Price><cbc:PriceAmount>210</cbc:PriceAmount><cbc:BaseQuantity>2</cbc:BaseQuantity></cac:Price></cac:InvoiceLine>
</Invoice>`;
