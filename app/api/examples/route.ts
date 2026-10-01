import {analysisRoute} from '@/lib/server/analysis';
import {EXAMPLE_ID} from '@/lib/server/filing';
import {requireActor} from '@/lib/server/auth';
import {route,json} from '@/lib/server/http';
export const dynamic='force-dynamic';
export const GET=route(async(req:Request)=>{await requireActor(req);return json({examples:[{id:EXAMPLE_ID,title:'A six-day historical filing delay',description:'January 2022 GSTR-3B illustration. Prepared inputs, deterministic ₹300 result, no provider call.',prepared:true}]});});
export const POST=analysisRoute('filing',true);
