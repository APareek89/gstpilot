import {randomUUID} from 'node:crypto';
import {query,transaction} from './db';
import {requireExecution,isPrepared,isMock} from './execution';
import {HttpError} from './http';
type PriceRequest={provider:string;model:string;inputBytes:number;maxOutputTokens:number;inputPrice:number;outputPrice:number;cachedPrice?:number};
function limit(name:string,fallback:string){const n=Number(process.env[name]||fallback);if(!Number.isFinite(n)||n<=0||n>20)throw new Error('Invalid usage limit.');return n;}
export async function reserve(v:PriceRequest):Promise<string>{
 const e=requireExecution();if((e.deadlineMs??0)<Date.now())throw new HttpError(408,'Analysis timed out.');if(isPrepared()||isMock())throw new Error('Prepared and mock work cannot reserve paid usage.');
 if(!Number.isInteger(v.inputBytes)||v.inputBytes<1||v.inputBytes>128000||!Number.isInteger(v.maxOutputTokens)||v.maxOutputTokens<1||v.maxOutputTokens>4096||![v.inputPrice,v.outputPrice,v.cachedPrice??v.inputPrice].every(n=>Number.isFinite(n)&&n>=0&&n<=100))throw new HttpError(400,'Provider request exceeds its supported limit.');
 const cost=((v.inputBytes+4096)*v.inputPrice+v.maxOutputTokens*v.outputPrice)/1e6,id=randomUUID();
 return transaction(async c=>{
  await c.query('select pg_advisory_xact_lock(83451001)');
  const valid=await c.query('select s.id from gstpilot_sessions s join gstpilot_users u on u.id=s.owner_id where s.id=$1 and s.owner_id=$2 and s.revoked_at is null and s.expires_at>now() and not u.disabled',[e.sessionId,e.ownerId]);
  if(!valid.rowCount)throw new HttpError(401,'Sign in to continue.');
  const t=(await c.query(`select count(*)::int n,coalesce(sum(coalesce(actual_usd,reserved_usd)) filter(where status!='released'),0)::float8 total,coalesce(sum(coalesce(actual_usd,reserved_usd)) filter(where owner_id=$1 and status!='released'),0)::float8 own,count(*) filter(where status in ('reserved','dispatched'))::int active,count(*) filter(where status in ('reserved','dispatched') and owner_id=$1)::int own_active,count(*) filter(where request_id=$2 and owner_id=$1)::int request_calls from gstpilot_usage`,[e.ownerId,e.requestId])).rows[0];
  if(t.n>=100000||t.total+cost>limit('GSTPILOT_SHARED_BUDGET_USD','2')||t.own+cost>limit('GSTPILOT_OWNER_BUDGET_USD','0.25'))throw new HttpError(429,'The included usage budget is used. The prepared example remains free.');
  if(t.active>=3||t.own_active>=1||t.request_calls>=(e.purpose==='filing'?1:12))throw new HttpError(429,'Request capacity is busy or this request reached its call limit.');
  await c.query(`insert into gstpilot_usage(id,owner_id,session_id,request_id,thread_id,kind,provider,model,input_price,output_price,cached_price,reserved_usd,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reserved')`,[id,e.ownerId,e.sessionId,e.requestId,e.threadId??null,e.purpose,v.provider,v.model,v.inputPrice,v.outputPrice,v.cachedPrice??null,cost]);return id;
 });
}
export async function markDispatched(id:string){
 const e=requireExecution();const accepted=await transaction(async c=>{
  const row=(await c.query(`select u.status,s.revoked_at,s.expires_at>now() active,p.disabled from gstpilot_usage u join gstpilot_sessions s on s.id=u.session_id and s.owner_id=u.owner_id join gstpilot_users p on p.id=u.owner_id where u.id=$1 and u.owner_id=$2 and u.session_id=$3 for update of u`,[id,e.ownerId,e.sessionId])).rows[0];
  if(!row||row.status!=='reserved')throw new HttpError(409,'Provider attempt is no longer available.');
  if(row.revoked_at||!row.active||row.disabled||(e.deadlineMs??0)<Date.now()){await c.query("update gstpilot_usage set status='released',settled_at=now() where id=$1 and owner_id=$2 and status='reserved'",[id,e.ownerId]);return false;}
  await c.query("update gstpilot_usage set status='dispatched',dispatched_at=now() where id=$1 and owner_id=$2 and status='reserved'",[id,e.ownerId]);return true;
 });if(!accepted)throw new HttpError(401,'Sign in to continue.');
}
export async function settle(id:string,v:{inputTokens:number;outputTokens:number;cachedInputTokens?:number;reasoningOutputTokens?:number;requestId?:string;providerModel?:string}){
 const e=requireExecution();if(![v.inputTokens,v.outputTokens,v.cachedInputTokens??0,v.reasoningOutputTokens??0].every(n=>Number.isInteger(n)&&n>=0&&n<=1e7)){await uncertain(id);return;}
 const cached=Math.min(v.inputTokens,Math.max(0,v.cachedInputTokens||0)),reasoning=Math.min(v.outputTokens,Math.max(0,v.reasoningOutputTokens||0));
 await query(`update gstpilot_usage set actual_usd=(($3::numeric-$5)*input_price+$5*coalesce(cached_price,input_price)+$4::numeric*output_price)/1000000,input_tokens=$3,output_tokens=$4,cached_input_tokens=$5,reasoning_output_tokens=$6,provider_request_id=$7,provider_model=$8,status='complete',settled_at=now() where id=$1 and owner_id=$2 and status='dispatched'`,[id,e.ownerId,v.inputTokens,v.outputTokens,cached,reasoning,v.requestId?.slice(0,200)??null,v.providerModel&&/^[A-Za-z0-9._:/-]{1,128}$/.test(v.providerModel)?v.providerModel:null]);
}
export async function uncertain(id:string){const e=requireExecution();await query("update gstpilot_usage set status=case when status='reserved' then 'released' else 'uncertain' end,settled_at=now() where id=$1 and owner_id=$2 and status in ('reserved','dispatched')",[id,e.ownerId]);}
export async function withCapacity<T>(owner:string,fn:()=>Promise<T>):Promise<T>{
 const id=randomUUID();await transaction(async c=>{await c.query('select pg_advisory_xact_lock(83451002)');await c.query('delete from gstpilot_operations where expires_at<now()');const t=(await c.query('select count(*)::int total,count(*) filter(where owner_id=$1)::int own from gstpilot_operations',[owner])).rows[0];if(t.total>=3||t.own>=1)throw new HttpError(429,'Wait for the current analysis to finish.');await c.query("insert into gstpilot_operations(id,owner_id,expires_at) values($1,$2,now()+interval '5 minutes')",[id,owner]);});
 try{return await fn();}finally{await query('delete from gstpilot_operations where id=$1 and owner_id=$2',[id,owner]);}
}
