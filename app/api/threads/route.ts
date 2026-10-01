import {requireActor} from '@/lib/server/auth';import {route,json} from '@/lib/server/http';import {listThreads} from '@/lib/repositories/business';
export const GET=route(async(req:Request)=>{const a=await requireActor(req);return json({threads:await listThreads(a.id)});});
