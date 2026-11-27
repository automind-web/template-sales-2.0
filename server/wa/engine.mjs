import {AppError,id,now,sha,constantEqual,safeError} from './vault.mjs';
import {sql,first,rows,run,credential,recordUsage,usageLimit} from './store.mjs';
import {generate,transcribe} from './providers.mjs';
import {retrieve,systemPrompt} from './knowledge.mjs';
import {jsonBody} from './input.mjs';
import {leadForConversation} from './leads.mjs';

export function decision(a,c){
 if(!a.enabled)return 'Агент отключён';if(c.blocked)return 'Ответы запрещены';if(c.handoff)return 'Отвечает человек';
 if(c.is_group&&(!a.groups_enabled||!c.group_allowed))return 'Группа не разрешена';return null;
}
export async function receiveWebhook(request,env,agentId,secret){
 const a=await first(env,'SELECT * FROM agents WHERE id=?',agentId);if(!a)throw new AppError('Не найдено.',404);
 const expected=await credential(env,a,'webhook');if(!expected||!await constantEqual(expected,secret))throw new AppError('Доступ закрыт.',401);
 const body=await jsonBody(request,8*1024*1024);
 if(body.event&&(body.event.type!=='messages'||body.event.event!=='post'))return {received:0};
 if(!Array.isArray(body.messages)||body.messages.length>100)throw new AppError('Некорректное событие.');
 const identity=a.whapi_identity?JSON.parse(a.whapi_identity):null;
 if(identity?.channelId&&body.channel_id!==identity.channelId)throw new AppError('Канал не совпадает.',403);
 let count=0;for(const msg of body.messages)if(await ingest(env,a,msg))count++;
 return {received:count};
}
export async function ingest(env,a,msg){
 if(!msg||typeof msg!=='object'||Array.isArray(msg))return false;
 if(typeof msg.from_me!=='boolean'||(msg.text?.body!==undefined&&typeof msg.text.body!=='string'))return false;
 if(msg.type!==undefined&&typeof msg.type!=='string')return false;
 if(msg.type==='text'&&(typeof msg.text?.body!=='string'||!msg.text.body.trim()))return false;
 if(typeof msg.id!=='string'||typeof msg.chat_id!=='string'||msg.id.length>200||msg.chat_id.length>100)return false;
 const chat=msg.chat_id;if(!/^[\d-]{5,40}@(s\.whatsapp\.net|c\.us|g\.us|lid)$/.test(chat))return false;
 if(msg.from_me&&msg.source==='api')return false;
 if(!msg.from_me&&!['text','voice','audio'].includes(msg.type))return false;
 if(await first(env,'SELECT event_id FROM receipts WHERE agent_id=? AND event_id=?',a.id,msg.id))return false;
 const old=typeof msg.timestamp==='number'&&Number.isFinite(msg.timestamp)&&msg.timestamp*1000+1000<a.created_at;
 if(old){await run(env,'INSERT OR IGNORE INTO receipts(agent_id,event_id,received_at) VALUES(?,?,?)',a.id,msg.id,now());return false;}
 const time=now(),convId=(await sha(`${a.id}:${chat}`)).slice(0,40),isGroup=chat.endsWith('@g.us')?1:0;
 const content=(msg.text?.body??(msg.type==='voice'||msg.type==='audio'?'Голосовое сообщение':'Сообщение оператора')).slice(0,16000);
 const manual=msg.from_me?1:0;
 const media=msg.voice??msg.audio??null;
 const guard='NOT EXISTS (SELECT 1 FROM receipts WHERE agent_id=? AND event_id=?)';
 const statements=[
  sql(env,'INSERT OR IGNORE INTO conversations(id,agent_id,chat_id,name,is_group,last_message_at) VALUES(?,?,?,?,?,?)',convId,a.id,chat,String(msg.chat_name??msg.from_name??chat.split('@')[0]).slice(0,100),isGroup,time),
  sql(env,`INSERT INTO messages(id,agent_id,conversation_id,external_id,role,type,content,media,epoch,created_at) SELECT ?,?,?,?, ?,?,?,?,epoch,? FROM conversations WHERE id=? AND ${guard}`,id(),a.id,convId,msg.id,manual?'assistant':'user',msg.type??'text',content,media?JSON.stringify(media):null,time,convId,a.id,msg.id),
  sql(env,`UPDATE conversations SET version=version+1,last_message_at=?,snippet=?,handoff=CASE WHEN ?=1 THEN 1 ELSE handoff END,reason=CASE WHEN ?=1 THEN 'Отвечает человек' ELSE reason END WHERE id=? AND ${guard}`,time,content.slice(0,120),manual,manual,convId,a.id,msg.id),
 ];
 if(manual)statements.push(sql(env,`UPDATE jobs SET status='cancelled',lease_token=NULL,updated_at=? WHERE conversation_id=? AND ${guard}`,time,convId,a.id,msg.id));
 else statements.push(sql(env,`INSERT INTO jobs(conversation_id,agent_id,status,due_at,version,epoch,updated_at) SELECT id,agent_id,'pending',?,version,epoch,? FROM conversations WHERE id=? AND ${guard} ON CONFLICT(conversation_id) DO UPDATE SET status=CASE WHEN jobs.status='uncertain' THEN 'uncertain' ELSE 'pending' END,due_at=excluded.due_at,version=excluded.version,epoch=excluded.epoch,lease_token=NULL,attempts=0,error=NULL,updated_at=excluded.updated_at`,time+a.delay_seconds*1000,time,convId,a.id,msg.id));
 statements.push(sql(env,'INSERT OR IGNORE INTO receipts(agent_id,event_id,received_at) VALUES(?,?,?)',a.id,msg.id,time));
 await env.DB.batch(statements);
 const c=await first(env,'SELECT * FROM conversations WHERE id=?',convId),reason=decision(a,c);
 // Новый собеседник — заявка в CRM филиала агента (ошибка заявки не мешает ответу клиенту).
 if(!manual&&!c.lead_id)await leadForConversation(env,a,c,msg.chat_name??msg.from_name??null).catch(error=>console.error('[wa] lead:',error instanceof Error?error.message:String(error)));
 if(reason){await run(env,'UPDATE conversations SET reason=? WHERE id=?',reason,convId);await run(env,"UPDATE jobs SET status='cancelled',lease_token=NULL WHERE conversation_id=? AND status='pending'",convId);}
 return true;
}
export async function clearConversation(env,a,conversationId){
 const c=await first(env,'SELECT * FROM conversations WHERE id=? AND agent_id=?',conversationId,a.id);if(!c)throw new AppError('Пользователь не найден.',404);
 if(a.whapi_status!=='connected')throw new AppError('Сначала проверьте подключение WhatsApp.',409,'whatsapp_not_connected');
 await env.DB.batch([
  sql(env,"UPDATE conversations SET epoch=epoch+1,version=version+1,snippet='',reason='' WHERE id=?",c.id),
  sql(env,'DELETE FROM messages WHERE conversation_id=?',c.id),
  sql(env,"UPDATE jobs SET status='cancelled',lease_token=NULL WHERE conversation_id=?",c.id),
  sql(env,"UPDATE outbox SET body='' WHERE conversation_id=?",c.id),
 ]);
 // receipts intentionally survive: provider redelivery must not resurrect deleted history.
}
// Acknowledge callbacks only when saved work is terminal. Whapi retries non-200
// callbacks, so persisted jobs also recover after a Worker interruption.
export async function drainWebhook(env,agentId,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxWait=15000}={}){
 const next=await first(env,"SELECT min(CASE WHEN status='pending' THEN due_at ELSE lease_until END) AS due FROM jobs WHERE agent_id=? AND status IN ('pending','generating','sending')",agentId);
 if(next?.due>now())await wait(Math.min(maxWait,next.due-now()));
 await tick(env,{agentId,fetcher});
 return !!await first(env,"SELECT 1 AS pending FROM jobs WHERE agent_id=? AND status IN ('pending','generating','sending') LIMIT 1",agentId);
}
export async function tick(env,{fetcher=fetch,agentId=null,limit=4}={}){
 await run(env,"UPDATE outbox SET state='uncertain',error='Прервано до подтверждения отправки',updated_at=? WHERE state='sending' AND updated_at<?",now(),now()-120000);
 await run(env,"UPDATE jobs SET status='uncertain',error='Проверьте доставку',lease_token=NULL WHERE status='sending' AND updated_at<?",now()-120000);
 const due=await rows(env,`SELECT conversation_id FROM jobs WHERE ((status='pending' AND due_at<=?) OR (status='generating' AND lease_until<?))${agentId?' AND agent_id=?':''} ORDER BY due_at LIMIT ?`,now(),now(),...(agentId?[agentId]:[]),limit);
 await Promise.allSettled(due.map(j=>processJob(env,j.conversation_id,fetcher)));
 return due.length;
}
async function processJob(env,convId,fetcher){
 const lease=id(),time=now();
 const job=await sql(env,"UPDATE jobs SET status='generating',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE conversation_id=? AND ((status='pending' AND due_at<=?) OR (status='generating' AND lease_until<?)) RETURNING *",lease,time+120000,time,convId,time,time).first();
 if(!job)return;
 try{
  let a=await first(env,'SELECT * FROM agents WHERE id=?',job.agent_id),c=await first(env,'SELECT * FROM conversations WHERE id=?',convId);
  if(!a||!c||decision(a,c)){await run(env,"UPDATE jobs SET status='cancelled',lease_token=NULL WHERE conversation_id=? AND lease_token=?",convId,lease);return;}
  if(a.whapi_status!=='connected')throw new AppError('Проверьте подключение WhatsApp.',409,'whatsapp_not_connected');
  const snapshot={revision:a.revision,version:c.version,epoch:c.epoch};
  let history=await rows(env,'SELECT * FROM messages WHERE conversation_id=? AND epoch=? AND (knowledge_version IS NULL OR knowledge_version=?) ORDER BY created_at DESC,rowid DESC LIMIT 30',c.id,c.epoch,a.kb_version);history.reverse();
  for(const m of history){
   if(m.role==='user'&&m.media&&!m.transcript){
    const audioReservation=await usageLimit(env,a);const file=await mediaFile(env,a,JSON.parse(m.media),fetcher),result=await transcribe(env,a,file,fetcher);await recordUsage(env,a,result,'audio',audioReservation);
    await run(env,'UPDATE messages SET transcript=?,translation=? WHERE id=? AND epoch=? AND EXISTS(SELECT 1 FROM conversations WHERE id=? AND epoch=?)',result.text,result.translation,m.id,snapshot.epoch,c.id,snapshot.epoch);
    m.transcript=result.text;m.translation=result.translation;
   }
  }
  const msgs=contextMessages(history,a.context_chars),kb=await retrieve(env,a,msgs.filter(m=>m.role==='user').slice(-3).map(m=>m.content).join('\n'));
  const reservation=await usageLimit(env,a);const result=await generate(env,a,msgs,systemPrompt(a,kb.context),fetcher);await recordUsage(env,a,result,'text',reservation);
  a=await first(env,'SELECT * FROM agents WHERE id=?',a.id);c=await first(env,'SELECT * FROM conversations WHERE id=?',convId);
  if(!a||!c||decision(a,c)||a.revision!==snapshot.revision||c.version!==snapshot.version||c.epoch!==snapshot.epoch){
   await run(env,"UPDATE jobs SET status='pending',due_at=?,lease_token=NULL WHERE conversation_id=? AND lease_token=?",now()+Math.max(1,a?.delay_seconds??10)*1000,convId,lease);return;
  }
  const outboundId=id(),sentAt=now();
  // Atomic final check and unique outbox turn fence the external side effect.
  await env.DB.batch([
   sql(env,"INSERT OR IGNORE INTO outbox(id,agent_id,conversation_id,version,epoch,revision,state,body,created_at,updated_at) SELECT ?,?,?,?, ?,?,'sending',?,?,? WHERE EXISTS(SELECT 1 FROM jobs j JOIN conversations c ON c.id=j.conversation_id JOIN agents a ON a.id=j.agent_id WHERE j.conversation_id=? AND j.lease_token=? AND j.status='generating' AND c.version=? AND c.epoch=? AND c.blocked=0 AND c.handoff=0 AND a.enabled=1 AND a.revision=? AND (c.is_group=0 OR (a.groups_enabled=1 AND c.group_allowed=1)))",outboundId,a.id,c.id,c.version,c.epoch,a.revision,result.text,sentAt,sentAt,c.id,lease,c.version,c.epoch,a.revision),
   sql(env,"UPDATE jobs SET status='sending',updated_at=? WHERE conversation_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM outbox WHERE id=?)",sentAt,c.id,lease,outboundId),
  ]);
  if(!await first(env,'SELECT id FROM outbox WHERE id=?',outboundId))return;
  const key=await credential(env,a,'whapi');if(!key)throw new AppError('Нет ключа WhatsApp.');
  let response,data;try{response=await fetcher('https://gate.whapi.cloud/messages/text',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({to:c.chat_id,body:result.text,no_link_preview:true})});data=await response.json();}catch{await uncertain(env,job,lease,outboundId);return;}
  if(!response.ok){
   const state=response.status>=500?'uncertain':'failed';await run(env,'UPDATE outbox SET state=?,error=?,updated_at=? WHERE id=?',state,'WhatsApp не принял сообщение',now(),outboundId);await run(env,'UPDATE jobs SET status=?,error=?,lease_token=NULL WHERE conversation_id=? AND lease_token=?',state,'Не удалось подтвердить отправку',convId,lease);return;
  }
  const externalId=data.message?.id??data.id;
  if(!externalId){await uncertain(env,job,lease,outboundId);return;}
  await env.DB.batch([
   sql(env,"UPDATE outbox SET state='sent',external_id=?,updated_at=? WHERE id=?",externalId,now(),outboundId),
   sql(env,"INSERT OR IGNORE INTO messages(id,agent_id,conversation_id,external_id,role,type,content,epoch,created_at,sources,knowledge_version) SELECT ?,?,?,?,'assistant','text',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND epoch=?)",id(),a.id,c.id,externalId,result.text,snapshot.epoch,now(),JSON.stringify(kb.sources),a.kb_version,c.id,snapshot.epoch),
   sql(env,"UPDATE jobs SET status='sent',lease_token=NULL,error=NULL,updated_at=? WHERE conversation_id=? AND lease_token=?",now(),c.id,lease),
   sql(env,"UPDATE conversations SET reason='' WHERE id=? AND version=?",c.id,snapshot.version),
  ]);
 }catch(error){
  const j=await first(env,'SELECT * FROM jobs WHERE conversation_id=?',convId);if(j?.lease_token!==lease)return;
  if(j.status==='sending'){const o=await first(env,"SELECT id FROM outbox WHERE conversation_id=? AND state='sending' ORDER BY created_at DESC LIMIT 1",convId);if(o)await uncertain(env,job,lease,o.id);return;}
  const retry=job.attempts<3&&(error?.code==='provider_unavailable'||error?.code==='upstream_429'||error?.code==='upstream_500'||error?.code==='upstream_502');
  await run(env,'UPDATE jobs SET status=?,due_at=?,error=?,lease_token=NULL,updated_at=? WHERE conversation_id=? AND lease_token=?',retry?'pending':'failed',now()+Math.min(60000,5000*2**job.attempts),safeError(error),now(),convId,lease);
  await run(env,'UPDATE conversations SET reason=? WHERE id=?',safeError(error),convId);
 }
}
async function uncertain(env,job,lease,outboundId){await env.DB.batch([sql(env,"UPDATE outbox SET state='uncertain',error='Результат отправки неизвестен',updated_at=? WHERE id=?",now(),outboundId),sql(env,"UPDATE jobs SET status='uncertain',error='Проверьте доставку в WhatsApp',lease_token=NULL,updated_at=? WHERE conversation_id=? AND lease_token=?",now(),job.conversation_id,lease),sql(env,"UPDATE conversations SET reason='Проверьте доставку в WhatsApp' WHERE id=?",job.conversation_id)]);}
export function contextMessages(history,maxChars){
 const selected=[];let size=0;
 for(const m of [...history].reverse()){const content=m.transcript?`[Голосовое, оригинал] ${m.transcript}${m.translation&&m.translation!==m.transcript?`\n[Перевод на русский] ${m.translation}`:''}`:m.content;if(size+content.length>maxChars&&selected.length)break;selected.unshift({role:m.role,content:content.slice(-maxChars)});size+=content.length;}
 while(selected[0]?.role==='assistant')selected.shift();
 // Combine consecutive turns for consistent Gemini semantics.
 return selected.reduce((out,m)=>{if(out.at(-1)?.role===m.role)out.at(-1).content+=`\n${m.content}`;else out.push({...m});return out;},[]);
}
async function mediaFile(env,a,media,fetcher){
 let url=media.link,headers={};
 if(!url&&media.id){url=`https://gate.whapi.cloud/media/${encodeURIComponent(media.id)}`;headers={authorization:`Bearer ${await credential(env,a,'whapi')}`};}
 let parsed;try{parsed=new URL(url);}catch{throw new AppError('Голосовое недоступно.',422);}
 if(parsed.protocol!=='https:'||!(parsed.hostname==='whapi.cloud'||parsed.hostname.endsWith('.whapi.cloud'))||parsed.username||parsed.password)throw new AppError('Недопустимый адрес голосового.',422);
 const response=await fetcher(parsed,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new AppError('Не удалось загрузить голосовое.',422);
 const chunks=[],reader=response.body.getReader();let length=0;
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024){await reader.cancel();throw new AppError('Голосовое больше 8 МБ.',413);}chunks.push(value);}
 return new File(chunks,['audio/mpeg','audio/mp3'].includes(media.mime_type)?'voice.mp3':'voice.ogg',{type:media.mime_type??response.headers.get('content-type')??'audio/ogg'});
}
