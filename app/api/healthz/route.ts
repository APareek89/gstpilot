import {database} from '@/lib/server/db';
import {origin,authSecret} from '@/lib/server/security';
export const dynamic='force-dynamic';
export async function GET(){try{origin();authSecret();await database();return Response.json({ok:true,auth:true,mock:process.env.GSTPILOT_MOCK_MODE==='1'},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({ok:false},{status:503});}}
