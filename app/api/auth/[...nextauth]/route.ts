import {NextRequest} from 'next/server';
import {handlers} from '@/lib/server/auth';
import {checkOrigin} from '@/lib/server/security';
import {readBytes,route} from '@/lib/server/http';
export const dynamic='force-dynamic';
export const GET=handlers.GET;
export const POST=route(async(req:NextRequest)=>{checkOrigin(req);const body=await readBytes(req,8192);return handlers.POST(new NextRequest(req.url,{method:'POST',headers:req.headers,body}));});
