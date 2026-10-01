import {randomUUID} from 'node:crypto';
import {requireActor} from './auth';
import {readJson,text,route,HttpError} from './http';
import {userLimit} from './security';
import {withExecution,type Execution} from './execution';
import {withCapacity} from './usage';
import {admitStorage,createThread,getThread,listMessages,appendMessage,historyContext,updatePending} from '../repositories/business';
import {analyzeFiling,EXAMPLE_FACTS,EXAMPLE_ID} from './filing';
import {askGSTPilot} from '../agents/pipeline';
import {loadMemory} from '../memory/store';
import {extractAndStoreMemories} from '../memory/extract';
import {compactIfNeeded} from '../memory/compact';
import {chunksById} from '../repositories/corpus';

async function bounded<T>(action:()=>Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([action(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HttpError(408,'Analysis timed out. Any known provider usage is retained.')),ms);})]);}finally{clearTimeout(timer);}}
export function analysisRoute(kind:'chat'|'filing',prepared=false){return route(async(req:Request)=>{
 const actor=await requireActor(req,{write:true});const body=await readJson(req,16384);
 if(prepared&&body.id!==EXAMPLE_ID)throw new HttpError(400,'Choose the available prepared example.');
 const facts=prepared?EXAMPLE_FACTS:text(kind==='filing'?body.facts:body.question,kind==='filing'?'Filing facts':'Question',8000);
 await userLimit(actor,prepared?'example':'analysis',prepared?20:30,3600);
 const execution:Execution={ownerId:actor.id,sessionId:actor.sid,requestId:randomUUID(),mode:prepared?'prepared':'live',purpose:kind,deadlineMs:Date.now()+120000};
 return new Promise<Response>((resolve,reject)=>{
  withExecution(execution,()=>withCapacity(actor.id,async()=>{
   await admitStorage(actor.id);
   const thread=body.threadId&&!prepared?await getThread(actor.id,body.threadId):await createThread(actor.id,facts,kind,prepared?EXAMPLE_ID:undefined);
   if(thread.prepared!==prepared||thread.kind!==kind)throw new HttpError(409,'Use a new conversation for this analysis mode.');
   const e={...execution,threadId:thread.id};
   let controller:ReadableStreamDefaultController<Uint8Array>,closed=false;
   const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel(){closed=true;}});
   const send=(v:unknown)=>{if(!closed)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(v)+'\n\n'));};
   resolve(new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}}));
   await withExecution(e,async()=>{
    send({type:'thread',threadId:thread.id,kind,prepared});
    try{await bounded(async()=>{
     const existing=prepared?await listMessages(actor.id,thread.id):[];
     const saved=existing.find(m=>m.role==='assistant');
     if(saved){send({type:'answer',messageId:saved.id,reply:saved.content,tier:saved.tier,citations:saved.citations,...saved.analysis,prepared:true,kind});return;}
     const context=prepared?'':await historyContext(thread.id);
     if(!existing.length)await appendMessage(thread.id,'user',facts);
     let result:any;
     if(kind==='filing'){
      send({type:'status',name:prepared?'prepared-inputs':'extract-filing-inputs',ok:true});
      const messages=prepared?[]:await listMessages(actor.id,thread.id);
      const userContext=messages.filter(m=>m.role==='user').slice(-8,-1).map(m=>m.content.slice(0,1500)).join('\n');
      result=await analyzeFiling(facts,userContext);send({type:'status',name:result.calculation?'deterministic-calculation':'scope-and-input-check',ok:true});
     }else{
      const memory=await loadMemory(actor.id);
      result=await askGSTPilot(facts,{context,userId:actor.id,threadId:thread.id,pending:thread.pending,memory,onStep:s=>send({type:'status',name:s.name,ok:s.ok})});
      if(result.pending!==undefined)await updatePending(thread.id,result.pending);
      const ids=[...new Set<string>([...result.reply.matchAll(/\[([A-Z]+-[A-Z]+\/[A-Za-z0-9./-]+?)\]/g)].map((m:any)=>m[1]))];
      result.citations=(await chunksById(ids)).map(c=>({id:c.id,heading:c.heading_path.join(' › '),snippet:c.text.slice(0,400),coverage:c.coverage}));
     }
     const analysis={kind,analysisKind:kind,prepared,coverage:result.coverage??null,inputs:result.inputs??null,calculation:result.calculation??null,escalated:!!result.escalated,abstained:!!result.abstained};
     const message=await appendMessage(thread.id,'assistant',result.reply,{tier:result.tier,citations:result.citations,traceId:result.traceId,analysis});
     send({type:'answer',messageId:message.id,reply:result.reply,tier:result.tier,citations:result.citations,...analysis});
     // Scope remains attached until this bounded post-answer work ends. Prepared/filing never enters it.
     if(kind==='chat'&&!prepared&&!result.escalated&&!result.abstained&&!closed){await extractAndStoreMemories(actor.id,thread.id,facts,result.reply,result.traceId).catch(()=>{});await compactIfNeeded(thread.id).catch(()=>{});}
    },140000);}catch(error){send({type:'error',message:error instanceof HttpError?error.message:'The analysis could not be completed. Please try again later.'});}
    finally{send({type:'done'});if(!closed){closed=true;controller.close();}}
   });
  })).catch(reject);
 });
});}
