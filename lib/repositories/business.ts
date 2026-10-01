import {randomUUID} from 'node:crypto';
import {query,transaction,ownerId} from '../server/db';
import {requireExecution} from '../server/execution';
import {HttpError} from '../server/http';
export async function getProfile(owner:string){return (await query('select user_id,email,sells,state,created_at from gstpilot_user_profile where user_id=$1',[ownerId(owner)])).rows[0]||null;}
export async function updateProfile(owner:string,patch:{sells?:string;state?:string}){return (await query('update gstpilot_user_profile set sells=coalesce($2,sells),state=coalesce($3,state) where user_id=$1 returning user_id,email,sells,state',[ownerId(owner),patch.sells??null,patch.state??null])).rows[0];}
export async function getThread(owner:string,id:string){const row=(await query('select * from gstpilot_threads where id=$1 and user_id=$2',[ownerId(id),ownerId(owner)])).rows[0];if(!row)throw new HttpError(404,'Conversation not found.');return row;}
export async function listThreads(owner:string){return (await query('select id,title,kind,prepared,created_at from gstpilot_threads where user_id=$1 order by created_at desc limit 100',[ownerId(owner)])).rows;}
export async function listMessages(owner:string,thread:string){await getThread(owner,thread);return (await query('select id,thread_id,role,content,tier,citations,trace_id,feedback,kind,prepared,analysis,created_at from gstpilot_messages where owner_id=$1 and thread_id=$2 order by created_at desc limit 200',[ownerId(owner),ownerId(thread)])).rows.reverse();}
export async function admitStorage(owner:string){
 return transaction(async c=>{
  await c.query('select pg_advisory_xact_lock(83451003)');
  const r=(await c.query(`select count(*)::int total,count(*) filter(where owner_id=$1)::int own,coalesce(sum(pg_column_size(m)) filter(where owner_id=$1),0)::float8 own_bytes,coalesce(sum(pg_column_size(m)),0)::float8 total_bytes from gstpilot_messages m`,[ownerId(owner)])).rows[0];
  if(r.total>=100000||r.own>=2000||r.own_bytes>8*1024*1024-131072||r.total_bytes>256*1024*1024-393216)throw new HttpError(429,'Saved conversation capacity is reached.');
 });
}
export async function createThread(owner:string,title:string,kind:'chat'|'filing',exampleId?:string){
 return transaction(async c=>{
  await c.query('select id from gstpilot_users where id=$1 for update',[ownerId(owner)]);
  if(exampleId){const old=(await c.query('select * from gstpilot_threads where user_id=$1 and example_id=$2',[owner,exampleId])).rows[0];if(old)return old;}
  if((await c.query('select count(*)::int n from gstpilot_threads where user_id=$1',[owner])).rows[0].n>=100)throw new HttpError(429,'Conversation limit reached.');
  return (await c.query('insert into gstpilot_threads(id,user_id,title,kind,prepared,example_id) values($1,$2,$3,$4,$5,$6) returning *',[randomUUID(),owner,title.slice(0,120),kind,!!exampleId,exampleId??null])).rows[0];
 });
}
export async function appendMessage(thread:string,role:'user'|'assistant',content:string,extra:Record<string,unknown>={}){
 const e=requireExecution();const t=await getThread(e.ownerId,thread);if(t.prepared!== (e.mode==='prepared'))throw new HttpError(409,'Prepared conversations are read-only. Start a new analysis.');
 if(Buffer.byteLength(content)>32768)throw new HttpError(413,'Response exceeds the saved message limit.');
 return (await query(`insert into gstpilot_messages(id,thread_id,owner_id,role,content,tier,citations,trace_id,kind,prepared,analysis) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[randomUUID(),thread,e.ownerId,role,content,extra.tier??null,JSON.stringify(extra.citations??[]),extra.traceId??null,t.kind,t.prepared,extra.analysis?JSON.stringify(extra.analysis):null])).rows[0];
}
export async function updatePending(thread:string,pending:unknown){const e=requireExecution();await getThread(e.ownerId,thread);if(JSON.stringify(pending).length>16000)throw new HttpError(413,'Conversation context is too large.');await query('update gstpilot_threads set pending=$3 where id=$1 and user_id=$2 and not prepared',[thread,e.ownerId,JSON.stringify(pending)]);}
export async function historyContext(thread:string){const e=requireExecution();const t=await getThread(e.ownerId,thread);const rows=(await query('select role,content from gstpilot_messages where thread_id=$1 and owner_id=$2 order by created_at desc limit 20',[thread,e.ownerId])).rows.reverse();return [t.summary?`Earlier summary: ${String(t.summary).slice(0,4000)}`:'',...rows.map(r=>`${r.role}: ${r.content.slice(0,800)}`)].filter(Boolean).join('\n');}
export async function setFeedback(owner:string,id:string,verdict:string,reason:string|null){
 const row=(await query('update gstpilot_messages set feedback=$3,feedback_reason=$4 where id=$1 and owner_id=$2 and role=\'assistant\' returning id',[ownerId(id),ownerId(owner),verdict,reason])).rows[0];if(!row)throw new HttpError(404,'Message not found.');return row;
}
export async function getFacts(owner:string){return (await query('select * from gstpilot_user_memory where user_id=$1 order by kind,as_of desc limit 200',[ownerId(owner)])).rows;}
export async function editFact(owner:string,id:string,value:string){const r=await query('update gstpilot_user_memory set value=$3,confidence=0.9,as_of=now(),last_confirmed=now() where id=$1 and user_id=$2 returning id',[ownerId(id),ownerId(owner),value]);if(!r.rowCount)throw new HttpError(404,'Memory not found.');}
export async function deleteFact(owner:string,id:string){const r=await query('delete from gstpilot_user_memory where id=$1 and user_id=$2 returning id',[ownerId(id),ownerId(owner)]);if(!r.rowCount)throw new HttpError(404,'Memory not found.');}
export async function remember(owner:string,fact:string,value:string,provenance:string|undefined,confirmed=false,kind:"behavioral"|"default"="behavioral"){
 const e=requireExecution();if(owner!==e.ownerId)throw new HttpError(404,'Memory not found.');if(e.mode==='prepared')return;
 if(provenance)await getThread(owner,provenance);
 if(fact.length>120||value.length>200)throw new HttpError(400,'Memory exceeds its limit.');
 await transaction(async c=>{await c.query('select id from gstpilot_users where id=$1 for update',[owner]);const old=(await c.query('select id,value,confidence from gstpilot_user_memory where user_id=$1 and fact=$2',[owner,fact])).rows[0];
 if(!old&&(await c.query('select count(*)::int n from gstpilot_user_memory where user_id=$1',[owner])).rows[0].n>=200)throw new HttpError(429,'Memory capacity reached.');
 const confidence=confirmed?0.9:old?.value===value?Math.min(0.7,Number(old.confidence)+0.1):0.4;
 await c.query(`insert into gstpilot_user_memory(user_id,fact,value,confidence,provenance,kind,last_confirmed) values($1,$2,$3,$4,$5,$6,case when $7 then now() else null end) on conflict(user_id,fact) do update set value=excluded.value,confidence=excluded.confidence,provenance=excluded.provenance,kind=excluded.kind,as_of=now(),last_confirmed=excluded.last_confirmed`,[owner,fact,value,confidence,provenance??null,kind,confirmed]);});
}
