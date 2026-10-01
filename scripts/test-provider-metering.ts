import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {query,closeDatabase} from '../lib/server/db';
import {withExecution} from '../lib/server/execution';
import ProviderClient from '../lib/providers/client';

// Real isolated PostgreSQL and the actual provider adapter; HTTP is replaced here.
// A preload separately denies all non-loopback sockets, DNS and native fetch.
const originalFetch=globalThis.fetch;
const checks:string[]=[];
async function main(){
 assert.equal(process.env.NODE_ENV,'test');
 assert.equal(process.env.GSTPILOT_MOCK_MODE,'1');
 assert.equal(process.env.OPENAI_API_KEY,undefined);
 assert.equal(process.env.ANTHROPIC_API_KEY,undefined);
 const ownerId=randomUUID(),sessionId=randomUUID();
 await query('insert into gstpilot_users(id,email,password_hash) values($1,$2,$3)',[ownerId,ownerId+'@test.invalid','fixture-not-a-login']);
 await query("insert into gstpilot_sessions(id,owner_id,expires_at) values($1,$2,now()+interval '1 hour')",[sessionId,ownerId]);
 process.env.GSTPILOT_MOCK_MODE='0';
 process.env.GSTPILOT_PROVIDER='openai';
 process.env.OPENAI_API_KEY='synthetic-transport-fixture';
 const input={model:'claude-haiku-4-5-20251001',max_tokens:64,temperature:0,messages:[{role:'user' as const,content:'Synthetic extraction'}]};
 const actor=()=>({ownerId,sessionId,requestId:randomUUID(),mode:'live' as const,purpose:'filing' as const,deadlineMs:Date.now()+30000});
 let sends=0;
 globalThis.fetch=async(url,options)=>{
  sends++;assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(options?.redirect,'error');
  const body=JSON.parse(String(options?.body));assert.equal(body.model,'gpt-4o-mini');assert.equal(body.max_tokens,64);
  return Response.json({id:'chatcmpl-synthetic',model:'gpt-4o-mini-2024-07-18',usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20}},choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call_fixture',type:'function',function:{name:'gstr_late_fee',arguments:'{broken'}}]}}]},{headers:{'x-request-id':'req_synthetic'}});
 };
 const first=actor();
 await assert.rejects(()=>withExecution(first,()=>new ProviderClient().messages.create(input)),{category:'invalid_response'});
 let rows=(await query('select status,input_tokens,output_tokens,cached_input_tokens,actual_usd,provider_request_id,provider_model from gstpilot_usage where owner_id=$1 and request_id=$2',[ownerId,first.requestId])).rows;
 assert.equal(sends,1);assert.equal(rows.length,1);assert.equal(rows[0].status,'complete');assert.equal(rows[0].input_tokens,100);assert.equal(rows[0].output_tokens,10);assert.equal(rows[0].cached_input_tokens,20);assert.equal(Number(rows[0].actual_usd),0.0000195);assert.equal(rows[0].provider_request_id,'req_synthetic');assert.equal(rows[0].provider_model,'gpt-4o-mini-2024-07-18');
 checks.push('actual provider adapter settles known tokens, cache, returned model and cost in PostgreSQL before malformed tool arguments fail');
 sends=0;globalThis.fetch=async()=>{sends++;throw new TypeError('synthetic response dropped');};
 const second=actor();
 await assert.rejects(()=>withExecution(second,()=>new ProviderClient().messages.create(input)),{category:'transport_unknown'});
 rows=(await query('select status,reserved_usd,actual_usd,dispatched_at from gstpilot_usage where owner_id=$1 and request_id=$2',[ownerId,second.requestId])).rows;
 assert.equal(sends,1);assert.equal(rows.length,1);assert.equal(rows[0].status,'uncertain');assert.ok(Number(rows[0].reserved_usd)>0);assert.equal(rows[0].actual_usd,null);assert.ok(rows[0].dispatched_at);
 checks.push('dropped response produces exactly one dispatched attempt and retains its conservative reservation in PostgreSQL');
 console.log(JSON.stringify({status:'passed',checks,count:checks.length,ownerId,real_provider_calls:0,transport:'mocked; external network denied',database:'actual isolated PostgreSQL'}));
}
main().catch(e=>{console.log(JSON.stringify({status:'failed',checks,category:e?.name,code:e?.code??null}));process.exitCode=1;}).finally(async()=>{globalThis.fetch=originalFetch;delete process.env.OPENAI_API_KEY;process.env.GSTPILOT_MOCK_MODE='1';await closeDatabase();});
