import {requireActor} from '@/lib/server/auth';import {route,json} from '@/lib/server/http';import {getThread,listMessages} from '@/lib/repositories/business';
export const GET=route(async(req:Request,ctx:{params:Promise<{id:string}>})=>{const a=await requireActor(req),{id}=await ctx.params;return json({thread:await getThread(a.id,id),messages:await listMessages(a.id,id)});});
