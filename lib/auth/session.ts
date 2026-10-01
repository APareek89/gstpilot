import { headers } from 'next/headers';
import { actorFor } from '../server/auth';
import { origin } from '../server/security';
import { redirect } from 'next/navigation';
export async function requireUser():Promise<{id:string;email:string}> {
  const actor=await actorFor(new Request(origin()+'/',{headers:await headers()}));
  if(!actor)redirect('/');
  return {id:actor.id,email:actor.email};
}
