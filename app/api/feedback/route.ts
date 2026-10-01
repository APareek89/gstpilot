import {requireActor} from '@/lib/server/auth';
import {route,json,readJson,HttpError} from '@/lib/server/http';
import {setFeedback} from '@/lib/repositories/business';
export const POST=route(async(req:Request)=>{const a=await requireActor(req,{write:true});const b=await readJson(req,4096);if(!['up','down'].includes(b.verdict)||b.verdict==='down'&&!['wrong','unclear','didnt_answer'].includes(b.reason))throw new HttpError(400,'Choose a feedback option.');await setFeedback(a.id,b.messageId,b.verdict,b.verdict==='down'?b.reason:null);return json({ok:true});});
