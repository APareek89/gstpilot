import test from 'node:test';
import assert from 'node:assert/strict';
import {citationTarget,hasHistoricalCalculation} from '../lib/client/citations';
test('persisted historical filing references open their actual official PDFs, never chunk routes',()=>{
  for(const c of [{id:'NOTIF-CT/nt-2021-019',url:'https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-19-central-tax-english-2021.pdf'},{id:'GST-COUNCIL/43-agenda-p168',url:'https://gstcouncil.gov.in/sites/default/files/Agenda/43rd_GSTCM-Volume-2.pdf'}])assert.deepEqual(citationTarget(c,true),{kind:'external',href:c.url});
});
test('actual corpus reference keeps its local inspector link; missing or unsafe historical URL is not a dead chunk link',()=>{
 assert.deepEqual(citationTarget({id:'CGST-ACT/s54'}),{kind:'chunk',href:'/admin/chunks/CGST-ACT%2Fs54'});
 assert.equal(citationTarget({id:'NOTIF-CT/nt-2021-019'},true).kind,'unavailable');
 for(const url of ['javascript:alert(1)','https://gstcouncil.gov.in.attacker.example/doc','https://user:password@gstcouncil.gov.in/doc'])assert.equal(citationTarget({id:'historical',url},true).kind,'unavailable');
});
test('filing escalation and missing-input response have no calculation disclosure; actual formula does',()=>{
 assert.equal(hasHistoricalCalculation({kind:'filing',tier:'T3',escalated:true,analysis:{calculation:null}}),false);
 assert.equal(hasHistoricalCalculation({kind:'filing',tier:'T2',analysis:{calculation:null}}),false);
 assert.equal(hasHistoricalCalculation({kind:'filing',tier:'T2',analysis:{calculation:{days_late:6,payable:300}}}),true);
});
