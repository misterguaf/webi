import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { budgetWorkbookModel, resultWorkbookModel } from '../gestio/src/domains/finance/treasury-export-model.js';

test('workbook models read one round from canonical D1 state and enforce server-side authority', async () => {
  const f=fixture();
  try {
    await f.login(104);
    await f.login(107);
    const round=await f.request(104,'/api/finance/rounds',{method:'POST',body:{
      code:'2026/2027',periodStart:'2026-10-01',periodEnd:'2027-09-30',annualFeeRoundId:id(901)
    }});
    assert.equal(round.status,201);
    const roundId=round.data.id;
    assert.equal((await f.request(104,`/api/finance/rounds/${roundId}/budget`,{method:'POST'})).status,201);
    const feeLine=await f.request(104,'/api/finance/budget-lines',{method:'POST',body:{
      roundId,code:'1.1',name:'Quotes',nature:'INCOME',plannedCents:1200000
    }});
    assert.equal(feeLine.status,201);
    const expenseLine=await f.request(104,'/api/finance/budget-lines',{method:'POST',body:{
      roundId,code:'3.3',name:'Subministraments',nature:'EXPENSE',plannedCents:50000
    }});
    assert.equal(expenseLine.status,201);
    const budget=await budgetWorkbookModel(f.db,f.context[104],id(999),roundId);
    assert.equal(budget.cells.D19,1200000);
    assert.equal(budget.cells.D20,0,'the draft template example amount must be cleared');
    assert.equal((await f.request(104,`/api/finance/rounds/${roundId}/open`,{method:'POST',body:{expectedVersion:1}})).status,200);
    const bank=await f.request(104,'/api/finance/positions',{method:'POST',body:{kind:'BANK',name:'Compte de prova'}});
    assert.equal(bank.status,201);
    const movement=await f.request(104,'/api/finance/movements',{method:'POST',body:{
      positionId:bank.data.id,operationDate:'2026-11-05',amountCents:2500,label:'Ingrés de prova'
    }});
    assert.equal(movement.status,201);
    assert.equal((await f.request(104,`/api/finance/movements/${movement.data.id}/allocations`,{method:'POST',body:{
      expectedVersion:0,allocations:[{kind:'INCOME',amountCents:2500,budgetLineId:feeLine.data.id}]
    }})).status,200);
    const evidence={filename:'ticket-synthetic.pdf',mime:'application/pdf',
      dataBase64:Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64')};
    const expense=await f.request(104,'/api/finance/expenses',{method:'POST',body:{
      roundId,expenseDate:'2026-11-06',totalCents:700,paymentMethod:'CASH',
      concept:'Subministrament de prova',lines:[{budgetLineId:expenseLine.data.id,amountCents:700}],
      recognise:true,evidence
    }});
    assert.equal(expense.status,201,JSON.stringify(expense.data));
    const result=await resultWorkbookModel(f.db,f.context[104],id(998),roundId);
    assert.equal(result.roundCode,'2026/2027');
    assert.equal(result.detail.Cuotas.income[0].cents,2500);
    assert.equal(result.detail.Cuotas.income[0].date,'2026-11-05');
    assert.equal(result.direct.J28,700);
    await assert.rejects(budgetWorkbookModel(f.db,f.context[107],id(997),roundId),/forbidden|permission|AUTHZ/i);
    await assert.rejects(resultWorkbookModel(f.db,f.context[107],id(996),roundId),/forbidden|permission|AUTHZ/i);
  } finally {f.close();}
});
