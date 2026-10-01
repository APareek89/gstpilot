import {fillSlots,buildClarification} from '../agents/clarify';
import {TOOL_SPECS,type ToolSpec} from '../tools/registry';
import {gstrLateFee} from '../calculators';
import {requireExecution} from './execution';
export const EXAMPLE_ID='historical-gstr3b';
export const EXAMPLE_FACTS='Illustrate a January 2022 GSTR-3B late filing: the due date I supply is 2022-02-20, filed on 2022-02-26, non-nil return, annual turnover ₹40 lakh.';
export const COVERAGE={id:'historical-gstr3b-jan2022',label:'Historical January 2022 GSTR-3B illustration',historical:true,reviewedAt:'2026-10-01',currentLawVerified:false,notice:'This illustrates a dated rule using your supplied due date. It does not verify that due date, all applicable State provisions, later amendments or exemptions, and does not submit a return.'};
export const SOURCES=[
 {id:'NOTIF-CT/nt-2021-019',heading:'Notification 19/2021 – Central Tax, 1 June 2021',url:'https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-19-central-tax-english-2021.pdf',date:'2021-06-01',snippet:'Historical Central Tax component caps for GSTR-3B from June 2021 onward: ₹250 for nil tax; ₹1,000 for non-nil turnover up to ₹1.5 crore; ₹2,500 above ₹1.5 crore through ₹5 crore. This source alone does not establish every State component or current exception.'},
 {id:'GST-COUNCIL/43-agenda-p168',heading:'43rd GST Council agenda, volume 2, page 168',url:'https://gstcouncil.gov.in/sites/default/files/Agenda/43rd_GSTCM-Volume-2.pdf',date:'2021-05-28',snippet:'Historical explanatory discussion of Notification 76/2018: combined daily late fee of ₹20 for nil returns and ₹50 otherwise, split between Central and State Tax. This is not a current consolidated law determination.'}
];
const spec:ToolSpec={...TOOL_SPECS.gstr_late_fee,purpose:'illustrate a historical January 2022 GSTR-3B late fee using dates you supply',generalRule:undefined,slots:[...TOOL_SPECS.gstr_late_fee.slots.map(s=>s.name==='return_type'?{...s,options:['GSTR-3B']}:s),{name:'tax_period',ask:'the return tax period (January 2022)',type:'enum',required:true,options:['2022-01']}]};
export async function analyzeFiling(facts:string,context?:string){
 const e=requireExecution();const prepared=e.mode==='prepared';
 const combined=[context||'',facts].join('\n');
 if(/\b(?:notice|drc[ -]?0?1|summons|seizure|proceedings|penalty order|dispute)\b/i.test(combined))return {kind:'filing',analysisKind:'filing',prepared,coverage:COVERAGE,inputs:{},calculation:null,reply:'A GST notice or proceeding requires a qualified GST professional. I cannot determine liability or recommend a response through this calculator.',tier:'T3',escalated:true,abstained:false,citations:[]};
 const fill=prepared?{values:{return_type:'GSTR-3B',tax_period:'2022-01',due_date:'2022-02-20',filing_date:'2022-02-26',nil_return:false,annual_turnover_inr:4000000} as Record<string,string|number|boolean>,missing:[]}:await fillSlots(spec,facts,context,undefined,true);
 const inputs=fill.values;const validDate=(v:unknown)=>typeof v==='string'&&/^2022-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const missing=[...fill.missing];
 for(const key of ['due_date','filing_date'])if(key in inputs&&(!validDate(inputs[key])||!combined.includes(String(inputs[key])))){delete inputs[key];if(!missing.some(s=>s.name===key))missing.push(spec.slots.find(s=>s.name===key)!);}
 const periods=[...combined.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})\b/gi)];
 const scope=inputs.tax_period==='2022-01' && periods.length>0 && periods.every(p=>/^jan/i.test(p[1])&&p[2]==='2022');
 const common={kind:'filing',analysisKind:'filing',prepared,coverage:COVERAGE,inputs,calculation:null as ReturnType<typeof gstrLateFee>|null};
 if(missing.length)return {...common,reply:buildClarification(spec,missing)+'\n\nOnly the historical January 2022 GSTR-3B illustration is supported here. Supply explicit ISO dates; no due date will be assumed.',tier:'T2',escalated:false,abstained:false,citations:[]};
 if(!scope||inputs.return_type!=='GSTR-3B'||!String(inputs.due_date).startsWith('2022-02-')||String(inputs.filing_date)<'2022-02-01'||String(inputs.filing_date)>'2022-03-31'||Number(inputs.annual_turnover_inr)<0||Number(inputs.annual_turnover_inr)>50000000){return {...common,reply:'The reviewed source coverage supports only a January 2022 GSTR-3B illustration with supplied February 2022 due dates, filing by March 2022 and turnover up to ₹5 crore. I cannot verify another period or current liability from these sources. Please consult a qualified GST adviser.',tier:'T2',escalated:false,abstained:true,citations:[]};}
 const calc=gstrLateFee(inputs as {due_date:string;filing_date:string;nil_return:boolean;annual_turnover_inr:number});calc.citation_ids=SOURCES.map(s=>s.id);
 return {...common,calculation:calc,reply:`Historical illustration: ₹${calc.payable.toLocaleString('en-IN')}.\n${calc.explanation}.\nDue date supplied: ${inputs.due_date}; filing date supplied: ${inputs.filing_date}.\n${COVERAGE.notice}`,tier:'T2',escalated:false,abstained:false,citations:SOURCES};
}
