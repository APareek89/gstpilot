import ProviderClient from '../providers/client';
import {query} from '../server/db';
import {requireExecution} from '../server/execution';
import {getThread} from '../repositories/business';

/** Fold only previously unsummarized older turns into the standing owner summary.
 * Runs inside the ordinary chat's existing deadline/capacity and provider budget. */
export async function compactIfNeeded(threadId:string){
 const actor=requireExecution();
 const thread=await getThread(actor.ownerId,threadId);
 if(actor.mode==='prepared'||thread.prepared||thread.kind!=='chat'||Date.now()>=(actor.deadlineMs??0))return;
 const total=Number((await query('select count(*) n from gstpilot_messages where thread_id=$1 and owner_id=$2',[threadId,actor.ownerId])).rows[0].n);
 const previous=Number(thread.summary_upto??0),available=total-20-previous;
 if(total<=24||available<=0)return;
 const take=Math.min(40,available);
 const older=(await query('select role,content from gstpilot_messages where thread_id=$1 and owner_id=$2 order by created_at,id offset $3 limit $4',[threadId,actor.ownerId,previous,take])).rows;
 const result=await new ProviderClient().messages.create({model:'claude-haiku-4-5-20251001',max_tokens:400,temperature:0,messages:[{role:'user',content:`Summarize this GST support conversation in <150 words: the user's stated business facts, amounts and dates, and conclusions reached. Preserve uncertainty and historical scope; never add legal advice or infer missing facts. Facts only.\n\nEarlier summary: ${String(thread.summary??'').slice(0,4000)}\n${older.map(m=>`${m.role}: ${String(m.content).slice(0,500)}`).join('\n')}`} ]});
 const summary=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
 if(!summary||Buffer.byteLength(summary)>4000)return;
 await query('update gstpilot_threads set summary=$3,summary_upto=$4 where id=$1 and user_id=$2 and not prepared and summary_upto=$5',[threadId,actor.ownerId,summary,previous+older.length,previous]);
}
