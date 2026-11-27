import {AppError} from './vault.mjs';
import {first,rows} from './store.mjs';

export async function conversationHistory(env,agent,conversation,url){
 const rawLimit=url.searchParams.get('limit')??'50';
 if(!/^\d+$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>100)throw new AppError('Некорректный размер страницы.');
 const limit=Number(rawLimit),before=url.searchParams.get('before'),epoch=url.searchParams.get('epoch');
 if(epoch!==null&&(!/^\d+$/.test(epoch)||Number(epoch)!==conversation.epoch))throw new AppError('История обновилась. Обновите переписку.',409,'history_changed');
 let anchor=null;
 if(before!==null){
  if(!before||before.length>100)throw new AppError('Некорректная страница истории.');
  anchor=await first(env,'SELECT rowid AS position,created_at FROM messages WHERE id=? AND agent_id=? AND conversation_id=? AND epoch=?',before,agent.id,conversation.id,conversation.epoch);
  if(!anchor)throw new AppError('История обновилась. Обновите переписку.',409,'history_changed');
 }
 const found=await rows(env,`SELECT m.id,m.role,m.type,m.content,m.transcript,m.translation,m.created_at,
  CASE WHEN m.role='user' THEN 'user' WHEN m.knowledge_version IS NOT NULL OR EXISTS(SELECT 1 FROM outbox o WHERE o.agent_id=m.agent_id AND o.conversation_id=m.conversation_id AND o.external_id=m.external_id AND o.state='sent') THEN 'agent' ELSE 'operator' END AS sender
  FROM messages m WHERE m.agent_id=? AND m.conversation_id=? AND m.epoch=?
  ${anchor?'AND (m.created_at<? OR (m.created_at=? AND m.rowid<?))':''}
  ORDER BY m.created_at DESC,m.rowid DESC LIMIT ?`,agent.id,conversation.id,conversation.epoch,...(anchor?[anchor.created_at,anchor.created_at,anchor.position]:[]),limit+1);
 const hasMore=found.length>limit,page=found.slice(0,limit);
 return {knowledgeVersion:agent.kb_version,conversation:{id:conversation.id,name:conversation.name,chat_id:conversation.chat_id,is_group:!!conversation.is_group,epoch:conversation.epoch},messages:page.reverse(),hasMore,nextCursor:hasMore?page[0].id:null};
}
