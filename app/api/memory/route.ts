import {requireActor} from '@/lib/server/auth';
import {route,json,readJson,text} from '@/lib/server/http';
import {getProfile,getFacts,editFact,deleteFact} from '@/lib/repositories/business';
import {effectiveConfidence,CONF_USABLE} from '@/lib/memory/store';
export const GET=route(async(req:Request)=>{const a=await requireActor(req);const facts=await getFacts(a.id);return json({profile:await getProfile(a.id),facts:facts.map(f=>({...f,effective_confidence:Number(effectiveConfidence(f).toFixed(2)),stale:effectiveConfidence(f)<CONF_USABLE}))});});
export const PATCH=route(async(req:Request)=>{const a=await requireActor(req,{write:true});const b=await readJson(req,4096);await editFact(a.id,b.id,text(b.value,'Memory value',200));return json({ok:true});});
export const DELETE=route(async(req:Request)=>{const a=await requireActor(req,{write:true});const b=await readJson(req,4096);await deleteFact(a.id,b.id);return json({ok:true});});
