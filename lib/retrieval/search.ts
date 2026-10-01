import {randomUUID} from 'node:crypto';
import {query as sql} from '../server/db';
import {requireExecution} from '../server/execution';
import {getEmbedder,EMBEDDING} from './embed';
import {transformQuery,type Transformation} from './transform';
import {chunksById} from '../repositories/corpus';
import type {LfParent} from '../observability/langfuse';
export const RETRIEVAL_CONFIG={rrf_k:60,channel_top_n:20,final_top_n:8,model:process.env.GSTPILOT_RETRIEVAL_MODE==='hybrid'?EMBEDDING.modelId:'postgresql-keyword'} as const;
export type ChannelHit={id:string;score:number;rank:number};
export type FusedHit={id:string;act:string;section:string|null;heading_path:string[];snippet:string;dense_rank:number|null;keyword_rank:number|null;rrf_score:number};
export type SearchResult={transformation:Transformation;dense:ChannelHit[];keyword:ChannelHit[];fused:FusedHit[];timings_ms:{transform:number;embed:number;dense:number;keyword:number;fused:number};traceId:string|null;mode?:'keyword'|'hybrid'};
export async function hybridSearch(query:string,source:string,parent?:LfParent,userHint?:string):Promise<SearchResult>{
 const e=requireExecution();if(query.length>8000)throw new Error('Search input exceeds the limit.');const start=Date.now();
 const hybrid=process.env.GSTPILOT_RETRIEVAL_MODE==='hybrid';
 // Keyword mode is an explicit free SQL channel. It never invents a vector or cosine score.
 const transformation:Transformation=hybrid?await transformQuery(query,parent,userHint):{original:query,rewritten:query,exact_tokens:[],direct_ids:[],hyde:null,needs_clarification:false,doc_type_hint:'unknown'} as unknown as Transformation;
 const tTransform=Date.now()-start,keywordInput=[transformation.rewritten,...transformation.exact_tokens].join(' ');let dense:ChannelHit[]=[],keyword:ChannelHit[]=[],fused:FusedHit[]=[];let tEmbed=0;
 const searchStart=Date.now();
 if(hybrid){const t=Date.now();const [vector]=await getEmbedder().embed([transformation.hyde??transformation.rewritten]);tEmbed=Date.now()-t;
  const [d,k,f]=await Promise.all([sql('select * from gstpilot_dense_search($1::vector,$2)',[JSON.stringify(vector),20]),sql('select * from gstpilot_keyword_search($1,$2)',[keywordInput,20]),sql('select * from gstpilot_hybrid_search($1::vector,$2,$3,$4)',[JSON.stringify(vector),keywordInput,8,transformation.doc_type_hint==='statute'?1.5:1])]);dense=d.rows.map((r,i)=>({...r,rank:i+1}));keyword=k.rows.map((r,i)=>({...r,rank:i+1}));fused=f.rows;
 }else{
  const rows=(await sql(`select id,act,section,heading_path,left(text,200) snippet,ts_rank_cd(fts,websearch_to_tsquery('english',$1)) score from gstpilot_legal_chunks where fts@@websearch_to_tsquery('english',$1) order by score desc,id limit 20`,[keywordInput])).rows;
  keyword=rows.map((r,i)=>({id:r.id,score:r.score,rank:i+1}));fused=rows.slice(0,8).map((r,i)=>({id:r.id,act:r.act,section:r.section,heading_path:r.heading_path,snippet:r.snippet,dense_rank:null,keyword_rank:i+1,rrf_score:1/(60+i+1)}));
 }
 if(transformation.direct_ids?.length){const direct=await chunksById(transformation.direct_ids);const ids=new Set(direct.map(r=>r.id));fused=[...direct.map(r=>({id:r.id,act:r.act,section:r.section,heading_path:r.heading_path,snippet:r.text.slice(0,200),dense_rank:null,keyword_rank:null,rrf_score:1})),...fused.filter(r=>!ids.has(r.id))].slice(0,8);}
 const elapsed=Date.now()-searchStart,result:SearchResult={transformation,dense,keyword,fused,timings_ms:{transform:tTransform,embed:tEmbed,dense:hybrid?elapsed:0,keyword:elapsed,fused:elapsed},traceId:null,mode:hybrid?'hybrid':'keyword'};
 const count=Number((await sql('select count(*) n from gstpilot_retrieval_traces where owner_id=$1',[e.ownerId])).rows[0].n);if(count>=2000)throw new Error('Retrieval history capacity reached.');
 const id=randomUUID();await sql('insert into gstpilot_retrieval_traces(id,owner_id,source,query,config,timings_ms,dense,keyword,fused) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,e.ownerId,source,query,JSON.stringify({...RETRIEVAL_CONFIG,mode:result.mode,transformation}),JSON.stringify(result.timings_ms),JSON.stringify(dense),JSON.stringify(keyword),JSON.stringify(fused)]);result.traceId=id;return result;
}
