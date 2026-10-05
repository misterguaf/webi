import { fillTreasuryTemplate } from './treasury-xlsx-template.js';
import { fillBudgetTemplate } from './budget-xlsx-template.js';
import { budgetWorkbookModel, resultWorkbookModel } from './treasury-export-model.js';
import { audit } from './shared.js';
// Wrangler bundles these immutable masters as private Data modules. They are never in /public.
// @ts-ignore Wrangler Data module
import resultMaster from '../../../templates/Tesorería General 26_27.xlsx';
// @ts-ignore Wrangler Data module
import budgetMaster from '../../../templates/PRESSUPOST ANUAL 26_27 (Boceto).xlsx';

const headers = filename => ({
  'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition':`attachment; filename="${filename}"`,
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",'X-Frame-Options':'DENY'
});

export async function downloadTreasuryWorkbook(db,context,requestId,roundId,kind) {
  // These model builders enforce current global finance permissions, including delegation scope,
  // expiry and revocation. No role label by itself authorises this download.
  const model=kind==='budget' ? await budgetWorkbookModel(db,context,requestId,roundId) :
    await resultWorkbookModel(db,context,requestId,roundId);
  const bytes=kind==='budget' ? await fillBudgetTemplate(budgetMaster,model) :
    await fillTreasuryTemplate(resultMaster,model);
  await audit(db,context,requestId,'EXPORT_REQUESTED','finance_round',roundId,Date.now()).run();
  const suffix=model.roundCode.replace('/','-');
  const filename=kind==='budget' ? `Pressupost_Parpallo_${suffix}.xlsx` : `Tresoreria_Parpallo_${suffix}.xlsx`;
  return new Response(bytes,{headers:headers(filename)});
}
