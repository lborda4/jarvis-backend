import { extendPayrollNoveltyConcepts, withPayrollAdditionalDeductions } from './payroll-novelty-concepts';
import { PayrollService } from './payroll.service';
const salary = { code:'salary', kind:'accrued', name:'Salario', active:true };
const custom = { code:'internal_bonus', kind:'accrued', category:'commissions', name:'Bono personalizado', active:true };
describe('Conceptos configurados para añadir novedades',()=>{
  it('agrega solo el concepto nuevo usado y preserva las bases históricas y definiciones existentes',()=>{
    const snapshot={minimumSalary:'1000000',concepts:[salary]};
    const result=extendPayrollNoveltyConcepts(snapshot,{concepts:[{...salary,name:'Otro nombre'},custom]},[{concept:custom.code,kind:custom.kind},{concept:custom.code,kind:custom.kind}]);
    expect(result.minimumSalary).toBe('1000000'); expect(result.concepts).toEqual([salary,custom]); expect(snapshot.concepts).toEqual([salary]);
  });
  it.each([undefined,{concepts:[]},{concepts:[{...custom,active:false}]},{concepts:[{...custom,kind:'deduction'}]}])('rechaza conceptos ajenos, inactivos o con otra naturaleza',configured=>{
    expect(()=>extendPayrollNoveltyConcepts({concepts:[salary]},configured,[{concept:custom.code,kind:custom.kind}])).toThrow('configuración activa');
  });
  it('al guardar persiste el catálogo ampliado dentro del snapshot de la misma nómina y empresa',async()=>{
    const state={employeeId:'employee',period:'2026-10',startDate:'2026-10-01',endDate:'2026-10-31',issueDate:'2026-10-29',workedDays:'30',paymentDates:['2026-10-31'],lines:[
      {id:'salary',concept:'salary',kind:'accrued',amount:'1000000',quantity:'30'},
      {id:'bonus',concept:custom.code,kind:'accrued',amount:'10000',quantity:'1',mapping:'untrusted'},
    ]};
    const employee={firstName:'Ana',surname:'Pérez',identification:'123',salary:'1000000',admittanceDate:'2026-01-01'};
    const snapshot={minimumSalary:'1000000',concepts:[salary]};
    const query=jest.fn(async(sql:string)=>{
      if(sql.startsWith('SELECT * FROM jarvis_payroll_documents')) return [{id:'document',employee_id:'employee',status:'DRAFT',employee_snapshot:employee,parameter_snapshot:snapshot,state}];
      if(sql.startsWith('SELECT data,active FROM jarvis_payroll_employees')) return [{data:employee,active:true}];
      if(sql.includes('FROM jarvis_payroll_parameters')) return [{data:sql.includes('now()')?{concepts:[salary,custom]}:snapshot}];
      if(sql.startsWith('INSERT INTO jarvis_payroll_documents')) return [{id:'document'}];
      return [];
    });
    const service=new PayrollService({transaction:async(fn:any)=>fn({query})} as never,{} as never,{} as never,{} as never);
    await service.saveDocument('company','actor','document',state);
    const write=query.mock.calls.find(call=>call[0].startsWith('INSERT INTO jarvis_payroll_documents')) as any;
    expect(write[0]).toContain('parameter_snapshot=EXCLUDED.parameter_snapshot');
    expect(write[1][1]).toBe('company');
    expect(JSON.parse(write[1][6]).concepts).toEqual([salary,custom]);
    expect(JSON.parse(write[1][4]).lines[1].mapping).toBe('commissions');
  });
});

it('ofrece los conceptos nuevos en configuraciones previas sin reactivar los deshabilitados', () => {
  const result = withPayrollAdditionalDeductions({ concepts: [{ code: 'labor_union', kind: 'deduction', active: false }] });
  expect(result.concepts.find(row => row.code === 'labor_union')?.active).toBe(false);
  expect(result.concepts.find(row => row.code === 'sanctions')?.active).toBe(true);
  expect(extendPayrollNoveltyConcepts({ concepts: [] }, undefined, [{ concept: 'sanctions', kind: 'deduction' }]).concepts).toEqual([expect.objectContaining({ code: 'sanctions', kind: 'deduction' })]);
  expect(() => extendPayrollNoveltyConcepts({ concepts: [] }, { concepts: [{ code: 'labor_union', kind: 'deduction', active: false }] }, [{ concept: 'labor_union', kind: 'deduction' }])).toThrow();
});

it('incorpora las nuevas deducciones de valor sin reactivar conceptos deshabilitados', () => {
  const result = withPayrollAdditionalDeductions({ concepts: [{ code: 'afc', kind: 'deduction', active: false }] });
  expect(result.concepts.find(item => item.code === 'afc')?.active).toBe(false);
  for (const code of ['third_party_payment_deduction', 'advance', 'other_deduction', 'voluntary', 'withholding', 'cooperative', 'garnishment', 'supplementary_plan', 'education', 'refund_deduction', 'debt'])
    expect(result.concepts).toContainEqual(expect.objectContaining({ code, kind: 'deduction', active: true }));
});
