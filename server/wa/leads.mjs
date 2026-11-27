// Заявка в CRM по первому сообщению нового собеседника WhatsApp.
// Лид создаётся в филиале агента, без ответственного; повтор события ничего не дублирует.
import {getFunnel} from '../crm/funnel.ts';
import {buildSearchText} from '../crm/leads.ts';
import {createDb,isUniqueViolation} from '../db.ts';
import {id,now} from './vault.mjs';

export function phoneFromChat(chatId){const m=/^(\d{6,15})@(s\.whatsapp\.net|c\.us)$/.exec(chatId);return m?`+${m[1]}`:null;}

export async function leadForConversation(env,a,conversation,name){
 if(!a.branch_id||conversation.is_group||conversation.lead_id)return conversation.lead_id??null;
 const phone=phoneFromChat(conversation.chat_id);
 if(phone){
  const existing=await env.DB.prepare('SELECT id FROM leads WHERE company_id=? AND branch_id=? AND client_phone=? ORDER BY closed_at IS NOT NULL, created_at DESC LIMIT 1').bind(a.owner_id,a.branch_id,phone).first();
  if(existing){await env.DB.prepare('UPDATE conversations SET lead_id=? WHERE id=?').bind(existing.id,conversation.id).run();return existing.id;}
 }
 const funnel=await getFunnel(createDb(env.DB),a.owner_id),stage=funnel.stages[0].key,time=now(),leadId=id();
 const clientName=String(name||phone||'Клиент WhatsApp').slice(0,120),opId=`wa-${conversation.id}`.slice(0,64);
 try{
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO leads (id, company_id, branch_id, number, client_name, client_phone, client_company, source, stage, owner_user_id, next_contact_at, amount, lost_reason, search_text, version, last_op_id, created_by, created_at, updated_at, stage_changed_at)
    SELECT ?, ?, ?, COALESCE(MAX(number), 0) + 1, ?, ?, NULL, 'whatsapp', ?, NULL, NULL, NULL, NULL, '', 1, ?, NULL, ?, ?, ? FROM leads WHERE company_id = ?`).bind(leadId,a.owner_id,a.branch_id,clientName,phone,stage,opId,time,time,time,a.owner_id),
   env.DB.prepare("INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at) VALUES (?, ?, ?, ?, 'created', 'source', NULL, ?, NULL, ?, ?)").bind(id(),leadId,a.owner_id,a.branch_id,stage,opId,time),
   env.DB.prepare('INSERT INTO lead_operations (op_id, lead_id, user_id, created_at) VALUES (?, ?, NULL, ?)').bind(opId,leadId,time),
   env.DB.prepare('UPDATE conversations SET lead_id=? WHERE id=?').bind(leadId,conversation.id),
  ]);
 }catch(error){
  if(!isUniqueViolation(error))throw error;
  // Параллельная доставка уже создала заявку для этого собеседника.
  const done=await env.DB.prepare('SELECT lead_id FROM lead_operations WHERE op_id=?').bind(opId).first();
  if(done){await env.DB.prepare('UPDATE conversations SET lead_id=? WHERE id=?').bind(done.lead_id,conversation.id).run();return done.lead_id;}
  throw error;
 }
 const created=await env.DB.prepare('SELECT number FROM leads WHERE id=?').bind(leadId).first();
 if(created)await env.DB.prepare('UPDATE leads SET search_text=? WHERE id=?').bind(buildSearchText(created.number,clientName,phone,null),leadId).run();
 return leadId;
}
