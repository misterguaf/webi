import {zipSync,strFromU8,strToU8} from 'fflate';
import {safeXlsx} from './budget-import-parser.js';
import {setCell,validateCents} from './treasury-xlsx-template.js';
export function fillImportedBudget(bytes,model){
 const files=safeXlsx(bytes);let xml=strFromU8(files[model.imported.sheetPath]);
 for(const [coord,cents] of Object.entries(model.cells))xml=setCell(xml,coord,validateCents(cents),11,{allowFormula:true});
 files[model.imported.sheetPath]=strToU8(xml);
 const workbook=strFromU8(files['xl/workbook.xml']);
 files['xl/workbook.xml']=strToU8(workbook.replace(/<calcPr\b[^>]*\/>/,'<calcPr fullCalcOnLoad="1" forceFullCalc="1"/>'));
 return zipSync(files,{level:6});
}
