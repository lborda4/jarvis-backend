const fs = require('fs');
const root = '../jarvis-frontend/src/';
function edit(path, fn) { const file=root+path; const old=fs.readFileSync(file,'utf8'); const value=fn(old.replace(/\r\n/g,'\n')); if(value===old) throw Error(path); fs.writeFileSync(file,value); }
edit('types/purchaseInvoiceItemDraft.ts', s=>s.replace('const retefuenteTaxFromSupplierConfig = supplierConfig?.retefuenteTax', "const retefuenteTaxFromSupplierConfig = document.status === 'PURCHASE_CREATED' && supplierConfig?.retefuenteTax"));
edit('utils/buildSiigoDocumentRequest.ts', s=>s.replace(/  \/\/ Retefuente sugerida por el historial[\s\S]*?  const editedRetefuenteTaxes =/, '  // Solo enviar las retenciones elegidas por el usuario.\n  const editedRetefuenteTaxes =').replace(/    : retefuenteTaxFromSupplierConfig\n      \? \[retefuenteTaxFromSupplierConfig\]\n      : \[\]/, '    : []'));
edit('pages/SupportDocumentPage.tsx', s=>s.replace('mapSuggestedRetentionsToTaxOptions(document.suggestedRetentions),', "mapSuggestedRetentionsToTaxOptions(\n              document.electronicDocumentType === 'PURCHASE_INVOICE' && document.status !== 'PURCHASE_CREATED'\n                ? [] : document.suggestedRetentions,\n            ),"));
edit('components/supportDocument/PurchaseInvoiceDetailEditor.tsx', s=>s.replace('      <PurchaseInvoiceItemsEditor', `      {!disabled && (document.suggestedItemConfig?.retefuenteTax || document.suggestedRetentions?.length) ? (
        <p role="note">
          Retenciones sugeridas por el historial: {Array.from(new Set([
            document.suggestedItemConfig?.retefuenteTax?.name,
            ...(document.suggestedRetentions ?? []).map((tax) => tax.name),
          ].filter(Boolean))).join(', ')}.
          {' '}Revisa y selecciona las que correspondan en los campos de retenciones. No se aplican automáticamente.
        </p>
      ) : null}
      <PurchaseInvoiceItemsEditor`));
edit('types/purchaseInvoiceItemDraft.test.ts', s=>s.replace(/expect\(draft.retefuenteTax\).toEqual\(\{\n      id: 4,\n      name: 'Servicios 4%',\n      type: 'Retefuente',\n      percentage: 4,\n    \}\)/g,'expect(draft.retefuenteTax).toBeNull()').replace('expect(draft.retefuenteTax?.id).toBe(4)', 'expect(draft.retefuenteTax).toBeNull()').replace('se autocompleta igual que el IVA (Araujo & Segovia SA)', 'no se aplica sin confirmación'));
edit('utils/buildSiigoDocumentRequest.test.ts', s=>s.replace(/expect\(request.retentions\).toEqual\(\[\n      \{ id: RETEFUENTE_TAX.id, type: RETEFUENTE_TAX.type \},\n    \]\)/, 'expect(request.retentions ?? []).toEqual([])').replace(/expect\(request.supplierPreferences\?\.retentions\).toEqual\(\[\n      \{\n        id: RETEFUENTE_TAX.id,[\s\S]*?\n    \]\)/, 'expect(request.supplierPreferences?.retentions ?? []).toEqual([])'));
edit('utils/purchaseInvoiceRowSummary.test.ts', s=>s.replace(/const expectedRetefuente = [^\n]+/, 'const expectedRetefuente = 0'));
