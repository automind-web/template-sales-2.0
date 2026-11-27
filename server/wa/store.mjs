import {AppError,id,now,seal,unseal} from './vault.mjs';
export const sql=(env,query,...args)=>env.DB.prepare(query).bind(...args);
export async function first(env,query,...args){return sql(env,query,...args).first();}
export async function rows(env,query,...args){return (await sql(env,query,...args).all()).results??[];}
export async function run(env,query,...args){return sql(env,query,...args).run();}
export async function ownedAgent(env,ownerId,agentId){const a=await first(env,'SELECT * FROM agents WHERE id=? AND owner_id=?',agentId,ownerId);if(!a)throw new AppError('Агент не найден.',404,'not_found');return a;}
export async function credential(env,a,provider){const c=await first(env,'SELECT value FROM credentials WHERE agent_id=? AND provider=?',a.id,provider);return c?unseal(env,c.value,`${a.owner_id}:${a.id}:${provider}`):null;}
export async function credentialChange(env,a,provider,value){
 if(!['whapi','openai','gemini','webhook'].includes(provider))throw new AppError('Неизвестное подключение.');
 if(value===null)return sql(env,'DELETE FROM credentials WHERE agent_id=? AND provider=?',a.id,provider);
 if(typeof value!=='string'||value.trim().length<12||value.length>4096)throw new AppError('Проверьте ключ: похоже, он скопирован не полностью.');
 const encrypted=await seal(env,value.trim(),`${a.owner_id}:${a.id}:${provider}`);
 return sql(env,'INSERT INTO credentials(agent_id,provider,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(agent_id,provider) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',a.id,provider,encrypted,now());
}
export async function setCredential(env,a,provider,value){await (await credentialChange(env,a,provider,value)).run();}
export async function publicAgent(env,a){const keys=await rows(env,"SELECT provider FROM credentials WHERE agent_id=? AND provider<>'webhook'",a.id);return {...a,owner_id:undefined,whapi_channel_hash:undefined,keys:Object.fromEntries(keys.map(k=>[k.provider,true])),enabled:!!a.enabled,groups_enabled:!!a.groups_enabled};}
// Универсальная стартовая инструкция: подходит любой компании, дальше её правят под себя.
export function basePrompt(company='нашей компании'){return `Ты — вежливый консультант компании «${company}» в WhatsApp. Твоя задача — быстро и по делу помочь клиенту и довести разговор до заявки.

Как вести разговор:
1. Если клиент только поздоровался — поздоровайся и спроси, чем можешь помочь. Если уже задал вопрос — сразу отвечай на него.
2. Отвечай коротко: 1–3 предложения, простыми словами, на языке клиента.
3. Цены, сроки, условия, наличие и адреса бери только из базы знаний. Если ответа там нет — честно скажи, что уточнишь у менеджера.
4. Задавай не больше одного уточняющего вопроса за раз, чтобы понять, что нужно клиенту.
5. Когда клиент готов купить, записаться или просит подробный расчёт — спроси имя и удобное время для связи и скажи, что менеджер свяжется.
6. Если клиент просит живого человека, недоволен или вопрос сложный — вежливо предложи связаться с менеджером.

Чего не делать:
- не обещай скидки, подарки и сроки, которых нет в базе знаний;
- не подтверждай оплату, бронь или заказ — это делает менеджер;
- не спорь с клиентом и не обсуждай темы, не связанные с компанией.`;}
export const BASE_PROMPT=basePrompt();
export async function createAgent(env,ownerId,name='Новый агент',{branchId=null,company=null}={}){const agentId=id(),time=now();await run(env,'INSERT INTO agents(id,owner_id,branch_id,name,prompt,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',agentId,ownerId,branchId,name.trim().slice(0,60)||'Новый агент',basePrompt(company||undefined),time,time);return ownedAgent(env,ownerId,agentId);}
export async function cancelAgentJobs(env,agentId){await run(env,"UPDATE jobs SET status='cancelled',lease_token=NULL,updated_at=? WHERE agent_id=? AND status IN ('pending','generating')",now(),agentId);}
export async function usageLimit(env,a){
 const reservation=id();const accepted=await sql(env,"INSERT INTO usage(id,agent_id,provider,model,kind,input_tokens,output_tokens,created_at) SELECT ?,?,?,?,'pending',0,0,? WHERE (SELECT count(*) FROM usage WHERE agent_id=? AND created_at>?)<? RETURNING id",reservation,a.id,a.provider,a.model,now(),a.id,now()-3600000,a.hourly_limit).first();
 if(!accepted)throw new AppError('Достигнут лимит ответов за час. Его можно увеличить в настройках агента.',429,'usage_limit');return reservation;
}
export async function recordUsage(env,a,result,kind='text',reservation=null){
 if(reservation){await run(env,'UPDATE usage SET provider=?,model=?,kind=?,input_tokens=?,output_tokens=? WHERE id=? AND agent_id=?',result.provider,result.model,kind,result.inputTokens??0,result.outputTokens??0,reservation,a.id);return;}
 await run(env,'INSERT INTO usage(id,agent_id,provider,model,kind,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)',id(),a.id,result.provider,result.model,kind,result.inputTokens??0,result.outputTokens??0,now());
}
