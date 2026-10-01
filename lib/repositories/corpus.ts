import {query} from '../server/db';
import {requireExecution} from '../server/execution';
export async function chunksById(ids:string[]){requireExecution();if(ids.length>30)throw new Error('Too many sources.');return (await query('select id,act,section,doc_type,heading_path,text,source_doc_id,effective_date,status,coverage from gstpilot_legal_chunks where id=any($1::text[])',[ids])).rows;}
export async function historicalCoverage(queryText:string){requireExecution();if(!/\b(?:january|jan)\s*2022\b/i.test(queryText)||!/(?:gstr[ -]?3b|filing|late fee)/i.test(queryText))return false;return Number((await query('select count(*) n from gstpilot_legal_chunks where coverage->>\'id\'=\'historical-gstr3b-jan2022\'')).rows[0].n)>=2;}
