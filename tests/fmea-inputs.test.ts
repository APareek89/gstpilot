import {describe,it,expect,vi} from 'vitest';
vi.mock('../lib/observability/langfuse',()=>({recordGeneration:async(_p:unknown,_o:unknown,fn:()=>unknown)=>fn()}));
import {validateSlot} from '../lib/agents/clarify';
import {isPlainArithmetic} from '../lib/agents/arithmetic-scope';
const date={name:'due_date',ask:'Due date',type:'date' as const,required:true};
describe('calendar extraction trust boundary',()=>{
 it.each(['2022-02-29','2024-02-30','2022-04-31','2022-13-01','not-a-date'])('rejects impossible date %s rather than silently rolling into another month',v=>expect(validateSlot(date,v)).toBeNull());
 it.each(['2024-02-29','2022-04-30','2022-02-28'])('preserves real date %s',v=>expect(validateSlot(date,v)).toBe(v));
});
describe('arithmetic never grants a legal coverage exemption',()=>{
 it.each(['Is 18% the current GST rate for 2026 footwear?','Calculate 18% interest on 200000','Is 18% applicable on 200000 of shoes?','Refund 18% of 200000','What is the rate on 18% GST for 200000?'])('denies a legal question containing numbers: %s',q=>expect(isPlainArithmetic(q,'calculation')).toBe(false));
 it('never lets a rate-lookup classification enter arithmetic',()=>expect(isPlainArithmetic('18% on 200000','rate_lookup')).toBe(false));
 it.each(['Calculate 18% of 2 lakh','2 lakh ka 18% kitna','Multiply 200 by 3'])('allows supplied standalone math: %s',q=>expect(isPlainArithmetic(q,'calculation')).toBe(true));
});
