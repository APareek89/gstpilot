import {requireActor} from '@/lib/server/auth';
import {route,json,readJson,text} from '@/lib/server/http';
import {getProfile,updateProfile} from '@/lib/repositories/business';
export const GET=route(async(req:Request)=>{const a=await requireActor(req);return json(await getProfile(a.id));});
export const POST=route(async()=>json({error:'Sign up with your email and password.'},410));
export const PATCH=route(async(req:Request)=>{const a=await requireActor(req,{write:true});const body=await readJson(req,4096);return json(await updateProfile(a.id,{sells:body.sells===undefined?undefined:text(body.sells,'What you sell',200),state:body.state===undefined?undefined:text(body.state,'State',80)}));});
