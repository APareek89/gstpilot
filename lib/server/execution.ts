import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from './http';
import { ownerId } from './db';
export type Execution = Readonly<{ownerId:string;sessionId:string;requestId:string;mode:'live'|'prepared';threadId?:string;purpose:'chat'|'filing'|'retrieval'|'triage';deadlineMs?:number}>;
const scope=new AsyncLocalStorage<Execution>();
export function withExecution<T>(execution:Execution,action:()=>T):T { ownerId(execution.ownerId);ownerId(execution.sessionId);ownerId(execution.requestId);return scope.run(Object.freeze({...execution,deadlineMs:execution.deadlineMs??Date.now()+120000}),action); }
export function requireExecution():Execution { const actor=scope.getStore();if(!actor)throw new HttpError(401,'Sign in to continue.');return actor; }
export function isPrepared(){return requireExecution().mode==='prepared';}
export function isMock(){return process.env.GSTPILOT_MOCK_MODE==='1';}
