import {describe,it,expect,vi,beforeEach} from 'vitest';
const fixture=vi.hoisted(()=>({lane:'rate_lookup',rate:vi.fn(),math:vi.fn(),coverage:vi.fn(async()=>false)}));
vi.mock('../lib/agents/intake',()=>({classifyIntake:async()=>({intake:{intent:'rate_lookup',tier:'T2',lane:fixture.lane,reason:'Session proxy classification'},g1_retries:0}),caHandoff:()=>''}));
vi.mock('../lib/repositories/corpus',()=>({historicalCoverage:fixture.coverage}));
vi.mock('../lib/agents/lanes/rate',()=>({runRateLane:fixture.rate}));
vi.mock('../lib/agents/lanes/calculation',()=>({runCalculationLane:vi.fn(()=>{throw Error('Legacy tax calculator must not run')}),tryGeneralMath:fixture.math}));
vi.mock('../lib/observability/langfuse',()=>({getLangfuse:()=>({trace:()=>({id:'fixture',event(){},update(){}}),flushAsync:async()=>{}}),beginBlindspotExecution:()=>({complete:async()=>{}}),recordGeneration:async()=>{throw Error('Unconfigured provider forbidden')}}));
import {askGSTPilot} from '../lib/agents/pipeline';
beforeEach(()=>{vi.clearAllMocks();fixture.lane='rate_lookup';fixture.math.mockResolvedValue({reply:'₹36,000. Arithmetic on supplied numbers only.'});});
describe('actual pipeline coverage routing with labelled session proxies',()=>{
 it('a percentage in a current-rate question cannot reach the legacy rate table',async()=>{
  const out=await askGSTPilot('Is 18% the current footwear GST rate in 2026?');
  expect(out.abstained).toBe(true);expect(out.reply).toContain('cannot verify current');expect(fixture.rate).not.toHaveBeenCalled();expect(fixture.math).not.toHaveBeenCalled();
 });
 it('standalone arithmetic ignores prior legal context and pending tax calculations',async()=>{
  fixture.lane='calculation';const q='Calculate 18% of 2 lakh';
  const out=await askGSTPilot(q,{context:'Previous discussion: a late fee',pending:{tool:'gstr_late_fee',intent:'late_fee_interest',values:{},assumed:{},missing:[],rejected:[],asked_at:new Date().toISOString()}});
  expect(out.reply).toContain('36,000');expect(fixture.math).toHaveBeenCalledWith(q,undefined,expect.anything());expect(fixture.coverage).not.toHaveBeenCalled();
 });
 it('failed arithmetic extraction asks for numbers rather than entering legacy legal lanes',async()=>{
  fixture.lane='calculation';fixture.math.mockResolvedValue(null);const out=await askGSTPilot('Calculate 18% of 2 lakh');
  expect(out.abstained).toBe(true);expect(out.reply).toContain('cannot infer a legal rate');expect(fixture.rate).not.toHaveBeenCalled();
 });
});
