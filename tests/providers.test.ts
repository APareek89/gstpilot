import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
const meter = vi.hoisted(() => ({ reserve: vi.fn(async () => 'reservation'), markDispatched: vi.fn(async () => {}), settle: vi.fn(async () => {}), uncertain: vi.fn(async () => {}) }));
vi.mock('../lib/server/usage', () => meter);
import ProviderClient from '../lib/providers/client';
import { withExecution } from '../lib/server/execution';
import { toWire, modelSpec, tokensFrom, messageFrom, MAX_INPUT_BYTES } from '../lib/providers/wire';
import { providerPost, RESPONSE_BYTES } from '../lib/providers/transport';
const nativeFetch = globalThis.fetch;
const actor = () => ({ ownerId: randomUUID(), sessionId: randomUUID(), requestId: randomUUID(), mode: 'live' as const, purpose: 'chat' as const });
const input = () => ({ model: 'claude-haiku-4-5-20251001', max_tokens: 64, temperature: 0, messages: [{ role: 'user' as const, content: 'Fixture extraction' }] });
const body = (extra: any = {}) => ({ id: 'chatcmpl-fixture', model: 'gpt-4o-mini-2024-07-18', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 19, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } }, ...extra });
beforeEach(() => { vi.clearAllMocks(); process.env.GSTPILOT_PROVIDER='openai'; process.env.GSTPILOT_MOCK_MODE='0'; process.env.OPENAI_API_KEY='test-provider-only'; delete process.env.GSTPILOT_OPENAI_MODEL; vi.stubGlobal('fetch',vi.fn(async () => { throw Error('Unconfigured test transport'); })); });
afterEach(() => vi.unstubAllGlobals());

describe('metered text/tool provider compatibility', () => {
 it('round-trips actual tool proposals and results into Chat Completions while preserving system text', async () => {
  let sent: any; vi.stubGlobal('fetch',vi.fn(async (url, options) => { expect(url).toBe('https://api.openai.com/v1/chat/completions'); expect(options.redirect).toBe('error'); sent=JSON.parse(options.body); return Response.json(body({ choices: [{ finish_reason:'tool_calls', message: { content:null, tool_calls:[{id:'call_1',type:'function',function:{name:'gstr_late_fee',arguments:'{"nil_return":false}'}}] } }] }),{headers:{'x-request-id':'req_fixture'}}); }));
  const response=await withExecution(actor(),()=>new ProviderClient().messages.create({...input(),system:'Use supplied records',tools:[{name:'gstr_late_fee',input_schema:{type:'object',properties:{nil_return:{type:'boolean'}}}}]}));
  expect(sent.messages[0]).toEqual({role:'system',content:'Use supplied records'}); expect(sent.tools[0].function.name).toBe('gstr_late_fee'); expect(sent.parallel_tool_calls).toBe(false);
  expect(response.stop_reason).toBe('tool_use'); expect(response.model).toBe('gpt-4o-mini-2024-07-18'); expect(response.content[0]).toMatchObject({type:'tool_use',input:{nil_return:false}});
  const next=toWire({...input(),messages:[...input().messages,{role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'{"fee":300}'}]}]},modelSpec(input().model));
  expect(next.messages).toMatchObject([{}, {role:'assistant',tool_calls:[{id:'call_1',function:{arguments:'{"nil_return":false}'}}]}, {role:'tool',tool_call_id:'call_1',content:'{"fee":300}'}]);
  expect(meter.settle).toHaveBeenCalledWith('reservation',expect.objectContaining({inputTokens:19,outputTokens:7,cachedInputTokens:3,requestId:'req_fixture'})); expect(fetch).toHaveBeenCalledTimes(1);
 });
 for (const [reason, message, category] of [
  ['length',{content:'partial'},'truncated'], ['content_filter',{content:null},'refusal'],
  ['tool_calls',{content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'calc',arguments:'{broken'}}]},'invalid_response']
 ] as const) it(`settles known usage before ${category} is rejected`,async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body({choices:[{finish_reason:reason,message}]}))));
  await expect(withExecution(actor(),()=>new ProviderClient().messages.create(input()))).rejects.toMatchObject({category});
  expect(meter.settle).toHaveBeenCalledTimes(1);expect(meter.uncertain).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('keeps malformed application JSON metered and does not parse or retry it in the adapter',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body({choices:[{finish_reason:'stop',message:{content:'{broken'}}]}))));
  const r=await withExecution(actor(),()=>new ProviderClient().messages.create(input()));expect(r.content[0]).toMatchObject({text:'{broken'});expect(meter.settle).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('records one uncertain dispatch on dropped transport or missing usage, without retries',async()=>{
  for(const response of [null,body({usage:undefined})]){vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn(async()=>{if(!response)throw Error('private upstream error');return Response.json(response);}));
   await expect(withExecution(actor(),()=>new ProviderClient().messages.create(input()))).rejects.toThrow(/Model request failed/);expect(fetch).toHaveBeenCalledTimes(1);expect(meter.markDispatched).toHaveBeenCalledTimes(1);expect(meter.uncertain).toHaveBeenCalledTimes(1);expect(meter.settle).not.toHaveBeenCalled();}
 });
 it('rejects absent actor, oversized text/output and image inputs before key or reservation',async()=>{
  await expect(new ProviderClient().messages.create(input())).rejects.toThrow('Sign in');
  for(const p of [{...input(),max_tokens:2049},{...input(),messages:[{role:'user',content:'x'.repeat(MAX_INPUT_BYTES)}]},{...input(),messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'http://169.254.169.254'}}]}]}]) await expect(withExecution(actor(),()=>new ProviderClient().messages.create(p as any))).rejects.toMatchObject({category:'input_bound'});
  expect(fetch).not.toHaveBeenCalled();expect(meter.reserve).not.toHaveBeenCalled();
 });
 it('mock and prepared scopes never reserve or access network',async()=>{
  for(const prepared of [true,false]){process.env.GSTPILOT_MOCK_MODE=prepared?'0':'1';delete process.env.OPENAI_API_KEY;const r=await withExecution({...actor(),mode:prepared?'prepared':'live'},()=>new ProviderClient().messages.create(input()));expect(r.usage.input_tokens).toBe(0);}
  expect(fetch).not.toHaveBeenCalled();expect(meter.reserve).not.toHaveBeenCalled();
 });
 it('preserves explicit Anthropic text/tool semantics and cached token pricing basis',()=>{
  process.env.GSTPILOT_PROVIDER='anthropic';const spec=modelSpec(input().model);const wire=toWire(input(),spec);expect(wire.model).toBe(input().model);
  const raw={model:input().model,stop_reason:'end_turn',content:[{type:'text',text:'fixture'}],usage:{input_tokens:10,output_tokens:4,cache_read_input_tokens:6}};
  const usage=tokensFrom(raw,'anthropic');expect(usage.inputTokens).toBe(16);expect(messageFrom(raw,spec,usage).content[0]).toMatchObject({text:'fixture'});
 });
});

describe('bounded decoded provider transport',()=>{
 it('consumes real fetch gzip decoding exactly once and preserves request ID',async()=>{
  const server=createServer((_q,r)=>{r.writeHead(200,{'content-type':'application/json','content-encoding':'gzip','x-request-id':'req_compressed'});r.end(gzipSync(JSON.stringify(body())));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
  try{vi.stubGlobal('fetch',vi.fn(async()=>nativeFetch(`http://127.0.0.1:${port}`)));const r=await providerPost('openai','fixture','{}');expect(r.requestId).toBe('req_compressed');expect(tokensFrom(r.raw,'openai').outputTokens).toBe(7);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 });
 it('bounds decoded success and error bytes and never retries rejection',async()=>{
  for(const status of [200,429]){vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(RESPONSE_BYTES+1),{status,headers:{'content-encoding':'gzip'}})));await expect(providerPost('openai','fixture','{}')).rejects.toMatchObject({category:'transport_unknown'});expect(fetch).toHaveBeenCalledTimes(1);}
 });
 it('uses the request deadline even when a transport ignores cancellation',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));await expect(providerPost('openai','fixture','{}',Date.now()+20)).rejects.toMatchObject({category:'transport_unknown'});expect(fetch).toHaveBeenCalledTimes(1);
 });
});
