// Owner-approved regression notes are private database records. Bundled legal/eval truth is immutable.
import {randomUUID} from 'node:crypto';
import {validateCase,type GoldenCase} from '../../evals/golden-schema';
import {requireExecution} from '../server/execution';
import {query,transaction} from '../server/db';
import {HttpError} from '../server/http';
export type GoldenDraft=Pick<GoldenCase,'question'|'expected_intent'|'expected_tier'|'unanswerable'|'relevant_chunk_ids'|'expected_answer_facts'|'must_not_contain'>&{note?:string};
export type AppendResult={ok:boolean;id:string;version:string;problems:string[]};
export async function appendGoldenCase(draft:GoldenDraft,opts:{sourceTraceId?:string;approvedBy?:string|null;policyVersion?:string;today?:string}):Promise<AppendResult>{
 const e=requireExecution(),id=randomUUID();if(JSON.stringify(draft).length>24000)throw new HttpError(413,'Golden case is too large.');
 if(opts.sourceTraceId&&!(await query('select id from gstpilot_messages where owner_id=$1 and trace_id=$2',[e.ownerId,opts.sourceTraceId])).rowCount)throw new HttpError(404,'Source feedback not found.');
 const gc:GoldenCase={...draft,id:'g'+id.replaceAll('-',''),status:'draft',policy_version:new Date().toISOString().slice(0,10),source_trace_id:opts.sourceTraceId,provenance:{author:'production',verified_by:null,verified_on:null}};
 const problems=validateCase({...gc,id:'g001'});if(problems.length)return {ok:false,id,version:'personal',problems};
 await transaction(async c=>{await c.query('select id from gstpilot_users where id=$1 for update',[e.ownerId]);if(Number((await c.query('select count(*) n from gstpilot_personal_golden where owner_id=$1',[e.ownerId])).rows[0].n)>=200)throw new HttpError(429,'Personal regression-note capacity reached.');await c.query('insert into gstpilot_personal_golden(id,owner_id,source_trace_id,labels) values($1,$2,$3,$4)',[id,e.ownerId,opts.sourceTraceId??null,JSON.stringify({...gc,owner_reviewed:true})]);});
 return {ok:true,id,version:'personal',problems:[]};
}
