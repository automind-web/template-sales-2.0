import {AppError,id,now,safeError,constantEqual} from './vault.mjs';
import {sql,first,rows,run,ownedAgent,publicAgent,createAgent,credential,credentialChange,cancelAgentJobs,usageLimit,recordUsage} from './store.mjs';
import {jsonBody as body} from './input.mjs';
import {curatedModels} from './model-catalog.mjs';
import {conversationHistory} from './history.mjs';
import {checkWhapi,setupWebhook} from './whapi.mjs';
import {discoverModels,generate,transcribe} from './providers.mjs';
import {retrieve,systemPrompt,saveDocument,deleteDocument} from './knowledge.mjs';
import {receiveWebhook,clearConversation,drainWebhook,contextMessages} from './engine.mjs';

/** Филиал компании для новых заявок из WhatsApp (необязателен) */
async function companyBranch(env,owner,branchId){if(branchId===null||branchId===undefined||branchId==='')return null;if(typeof branchId!=='string')throw new AppError('Выберите филиал.');const b=await first(env,'SELECT id FROM branches WHERE id=? AND company_id=? AND archived_at IS NULL',branchId,owner);if(!b)throw new AppError('Филиал не найден.',404);return b.id;}
export const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
export async function handleApi(request,env,identity,ctx={}){
 try{
  if(!env.DB)throw new AppError('Хранилище ещё не подключено.',503,'server_setup');
  const url=new URL(request.url),path=url.pathname.split('/').filter(Boolean).slice(2),method=request.method;
  if(path[0]==='webhooks'&&path[1]==='whapi'&&method==='POST'){
   const result=await receiveWebhook(request,env,path[2],request.headers.get('x-webhook-secret')??'');
   if(env.WAKE){env.WAKE();return json(result);}
   const work=drainWebhook(env,path[2]);if(ctx.waitUntil)ctx.waitUntil(work);
   const pending=await work;return json({...result,retry:pending},pending?503:200);
  }
  if(path[0]==='runtime'&&path[1]==='check-whapi'&&path[2]&&method==='POST'){
   if(!env.RUNTIME_SECRET||!await constantEqual(env.RUNTIME_SECRET,request.headers.get('x-runtime-secret')??''))throw new AppError('Доступ закрыт.',401);
   const agent=await first(env,'SELECT * FROM agents WHERE id=?',path[2]);if(!agent)throw new AppError('Не найдено.',404);const result=await checkWhapi(env,agent);return json({connected:result.connected,status:result.status,message:result.message});
  }
  // Вход, права (только директор) и защита от подделки запросов проверены в server/wa/gateway.ts.
  if(!identity?.userId)throw new AppError('Войдите в систему.',401,'sign_in_required');
  const owner=identity.userId;
  if(path[0]==='bootstrap'&&method==='GET'){
   await env.DB.batch([
    sql(env,"UPDATE jobs SET status='cancelled',lease_token=NULL WHERE agent_id IN (SELECT id FROM agents WHERE owner_id=? AND provider NOT IN ('openai','gemini')) AND status IN ('pending','generating')",owner),
    sql(env,"UPDATE agents SET provider='openai',model='gpt-6-luna',auth_mode='key',enabled=0,revision=revision+1 WHERE owner_id=? AND provider NOT IN ('openai','gemini')",owner),
    sql(env,"DELETE FROM credentials WHERE agent_id IN (SELECT id FROM agents WHERE owner_id=?) AND provider NOT IN ('whapi','openai','gemini','webhook')",owner),
   ]);
   const agents=await rows(env,'SELECT * FROM agents WHERE owner_id=? ORDER BY created_at',owner);
   return json({agents:await Promise.all(agents.map(a=>publicAgent(env,a))),chatgptPlan:false,branches:await rows(env,'SELECT id,name FROM branches WHERE company_id=? AND archived_at IS NULL ORDER BY name',owner)});
  }
  if(path[0]==='agents'&&path.length===1){
   if(method==='POST'){
    const data=await body(request);const n=await first(env,'SELECT count(*) AS n FROM agents WHERE owner_id=?',owner);if(n.n>=20)throw new AppError('Лимит — 20 агентов.');
    const branchId=await companyBranch(env,owner,data.branch_id),company=await first(env,'SELECT name FROM companies WHERE id=?',owner);const a=await createAgent(env,owner,typeof data.name==='string'?data.name:'Новый агент',{branchId,company:company?.name});return json({agent:await publicAgent(env,a)},201);
   }
  }
  if(path[0]!=='agents'||!path[1])throw new AppError('Не найдено.',404);
  const a=await ownedAgent(env,owner,path[1]),resource=path[2];
  if(!resource&&method==='GET'){
   const [documents,users,usage,errors]=await Promise.all([
    rows(env,'SELECT id,name,kind,length(content) AS characters,created_at,updated_at FROM documents WHERE agent_id=? ORDER BY updated_at DESC',a.id),
    rows(env,'SELECT c.* FROM conversations c WHERE agent_id=? ORDER BY last_message_at DESC LIMIT 300',a.id),
    first(env,'SELECT count(*) AS requests,coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens FROM usage WHERE agent_id=? AND created_at>?',a.id,now()-86400000),
    rows(env,"SELECT j.conversation_id,j.status,j.error,j.updated_at,c.name FROM jobs j JOIN conversations c ON c.id=j.conversation_id WHERE j.agent_id=? AND j.status IN ('failed','uncertain') ORDER BY j.updated_at DESC LIMIT 20",a.id),
   ]);return json({agent:await publicAgent(env,a),documents,users,usage,errors});
  }
  if(!resource&&method==='PATCH'){
   const data=await body(request);if(data.expectedRevision!==undefined&&data.expectedRevision!==a.revision)throw new AppError('Настройки изменились в другом окне. Страница обновлена.',409,'version_conflict');
   const allowed=new Set(['expectedRevision','provider','model','auth_mode','prompt','enabled','delay_seconds','groups_enabled','response_token_limit','context_chars','hourly_limit','name','branch_id']);
   if(Object.keys(data).some(k=>!allowed.has(k)))throw new AppError('Эта настройка больше не поддерживается.');
   const patch={};
   const enums={provider:['openai','gemini'],auth_mode:['key']};
   for(const [k,values]of Object.entries(enums))if(k in data){if(!values.includes(data[k]))throw new AppError('Недопустимая настройка.');patch[k]=data[k];}
   for(const [k,min,max]of [['delay_seconds',1,60],['response_token_limit',512,16384],['context_chars',4000,50000],['hourly_limit',1,10000]])if(k in data){if(!Number.isInteger(data[k])||data[k]<min||data[k]>max)throw new AppError('Значение настройки вне допустимого диапазона.');patch[k]=data[k];}
   if('branch_id' in data)patch.branch_id=await companyBranch(env,owner,data.branch_id);
   if('name' in data){if(typeof data.name!=='string'||!data.name.trim()||data.name.length>60)throw new AppError('Проверьте название агента.');patch.name=data.name.trim();}
   for(const [k,max]of [['model',150],['prompt',30000]])if(k in data){if(typeof data[k]!=='string'||data[k].length>max)throw new AppError('Проверьте текст настройки.');if(k==='model'&&!data[k].trim())throw new AppError('Поле не может быть пустым.');patch[k]=data[k];}
   for(const k of ['groups_enabled','enabled'])if(k in data){if(typeof data[k]!=='boolean')throw new AppError('Проверьте настройку.');patch[k]=data[k]?1:0;}
   if(('model' in patch||'provider' in patch)&&!curatedModels(patch.provider??a.provider).some(model=>model.id===(patch.model??a.model)))throw new AppError('Выберите модель из доступного списка.');
   if(patch.enabled===1){
    if(a.whapi_status!=='connected')throw new AppError('Сначала проверьте подключение WhatsApp.',409,'connection_required');
    const candidate={...a,...patch};if(!candidate.prompt.trim())throw new AppError('Добавьте инструкцию агента.');
    const models=await discoverModels(env,candidate,candidate.provider);if(!models.verified)throw new AppError('Добавьте ключ ChatGPT или Gemini.');
    if(!models.models.some(m=>m.id===candidate.model))throw new AppError('Выбранная модель недоступна этому аккаунту. Обновите список.');
    await setupWebhook(env,a);
   }
   const entries=Object.entries(patch);if(!entries.length)return json({agent:await publicAgent(env,a)});
   const statements=[];if(patch.prompt!==undefined&&patch.prompt!==a.prompt)statements.push(sql(env,'INSERT INTO prompt_versions(id,agent_id,content,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE id=? AND revision=?)',id(),a.id,a.prompt,now(),a.id,a.revision));
   statements.push(sql(env,`UPDATE agents SET ${entries.map(([k])=>`${k}=?`).join(',')},revision=revision+1,updated_at=? WHERE id=? AND revision=?`,...entries.map(([,v])=>v),now(),a.id,a.revision));
   const saved=await env.DB.batch(statements);if(!saved.at(-1)?.meta?.changes)throw new AppError('Настройки изменились в другом окне. Обновите страницу.',409,'version_conflict');if(patch.enabled===0)await cancelAgentJobs(env,a.id);return json({agent:await publicAgent(env,await ownedAgent(env,owner,a.id))});
  }
  if(!resource&&method==='DELETE'){const data=await body(request);if(data.confirmAgentId!==a.id)throw new AppError('Подтвердите удаление выбранного агента.',409,'confirmation_required');await run(env,'DELETE FROM agents WHERE id=? AND owner_id=?',a.id,owner);return json({deleted:true});}
  if(resource==='credentials'&&method==='POST'){
   const data=await body(request);if(!['whapi','openai','gemini'].includes(data.provider))throw new AppError('Неизвестное подключение.');
   const current=await credential(env,a,data.provider);if(typeof data.token==='string'&&current===data.token.trim())return json({agent:await publicAgent(env,a)});
   const changes=[await credentialChange(env,a,data.provider,data.token)];
   if(data.provider==='whapi')changes.push(sql(env,"DELETE FROM credentials WHERE agent_id=? AND provider='webhook'",a.id));
   const reset=data.provider==='whapi'?",whapi_status='missing',whapi_identity=NULL,whapi_channel_hash=NULL":'';
   changes.push(sql(env,`UPDATE agents SET enabled=0,revision=revision+1,updated_at=?${reset} WHERE id=?`,now(),a.id),sql(env,"UPDATE jobs SET status='cancelled',lease_token=NULL,updated_at=? WHERE agent_id=? AND status IN ('pending','generating')",now(),a.id));
   await env.DB.batch(changes);
   return json({agent:await publicAgent(env,await ownedAgent(env,owner,a.id))});
  }
  if(resource==='models'&&method==='GET')return json(await discoverModels(env,a,url.searchParams.get('provider')||a.provider));
  if(resource==='whapi'&&path[3]==='check'&&method==='POST')return json(await checkWhapi(env,a));
  if(resource==='documents'&&path[3]==='files'&&method==='POST'){
   const data=await body(request,6500000);
   if(!Array.isArray(data.files)||!data.files.length||data.files.length>20)throw new AppError('Выберите от 1 до 20 файлов за одну загрузку.');
   const results=[];
   for(const file of data.files){
    try{
     const saved=await saveDocument(env,a,file);
     results.push({name:file.name,status:'added',...saved});
    }catch(error){results.push({name:typeof file?.name==='string'?file.name:'Файл',status:error.code==='duplicate_document'?'duplicate':'error',error:safeError(error)});}
   }
   return json({results});
  }
  if(resource==='documents'&&path[3]&&method==='DELETE'){await deleteDocument(env,a,path[3]);return json({deleted:true});}
  if(resource==='prompts'&&method==='GET')return json({versions:await rows(env,'SELECT * FROM prompt_versions WHERE agent_id=? ORDER BY created_at DESC LIMIT 20',a.id)});
  if(resource==='users'&&path[3]){
   const c=await first(env,'SELECT * FROM conversations WHERE id=? AND agent_id=?',path[3],a.id);if(!c)throw new AppError('Пользователь не найден.',404);
   if(method==='GET'&&path[4]==='history')return json(await conversationHistory(env,a,c,url));
   if(path.length!==4)throw new AppError('Не найдено.',404);
   if(method==='PATCH'){
    const data=await body(request),patch={};for(const k of ['blocked','handoff','group_allowed'])if(k in data){if(typeof data[k]!=='boolean')throw new AppError('Проверьте настройку.');patch[k]=data[k]?1:0;}
    const entries=Object.entries(patch);if(!entries.length)throw new AppError('Действие не выбрано.');
    await env.DB.batch([sql(env,`UPDATE conversations SET ${entries.map(([k])=>`${k}=?`).join(',')},version=version+1 WHERE id=?`,...entries.map(([,v])=>v),c.id),sql(env,"UPDATE jobs SET status='cancelled',lease_token=NULL WHERE conversation_id=? AND status IN ('pending','generating')",c.id)]);return json({updated:true});
   }
   if(method==='DELETE'){await clearConversation(env,a,c.id);return json({cleared:true});}
  }
  if(resource==='test'&&method==='POST'){
   const data=await body(request,100000);if(!Array.isArray(data.messages)||!data.messages.length||data.messages.length>30)throw new AppError('Некорректный тестовый диалог.');
   let total=0;for(const m of data.messages){if(!m||typeof m!=='object'||Array.isArray(m)||!['user','assistant'].includes(m.role)||typeof m.content!=='string')throw new AppError('Некорректное сообщение.');total+=m.content.length;}if(total>50000)throw new AppError('Тестовый диалог слишком длинный. Откройте новый.');
   if(data.messages.at(-1).role!=='user')throw new AppError('Напишите сообщение.');
   const reservation=await usageLimit(env,a);const kb=await retrieve(env,a,data.messages.at(-1).content),result=await generate(env,a,contextMessages(data.messages,a.context_chars),systemPrompt(a,kb.context));await recordUsage(env,a,result,'test',reservation);
   return json({text:result.text,sources:kb.sources,usage:{input:result.inputTokens,output:result.outputTokens}});
  }
  if(resource==='audio'&&method==='POST'){
   if(Number(request.headers.get('content-length'))>9*1024*1024)throw new AppError('Голосовое больше 8 МБ.',413);
   const form=await request.formData(),file=form.get('file');if(!(file instanceof File))throw new AppError('Выберите голосовой файл.');
   const reservation=await usageLimit(env,a);const result=await transcribe(env,a,file);await recordUsage(env,a,result,'audio_test',reservation);
   return json({transcript:result.text,translation:result.translation,provider:result.provider});
  }
  if(resource==='delivery'&&path[3]&&method==='POST'){
   const data=await body(request);if(!['sent','cancelled'].includes(data.resolution))throw new AppError('Выберите результат проверки.');
   await env.DB.batch([sql(env,"UPDATE outbox SET state=?,updated_at=? WHERE conversation_id=? AND agent_id=? AND state='uncertain'",data.resolution,now(),path[3],a.id),sql(env,"UPDATE jobs SET status='cancelled',error=NULL WHERE conversation_id=? AND agent_id=? AND status='uncertain'",path[3],a.id),sql(env,"UPDATE conversations SET reason='' WHERE id=? AND agent_id=?",path[3],a.id)]);return json({resolved:true});
  }
  throw new AppError('Не найдено.',404);
 }catch(error){return json({error:safeError(error),code:error.code??'internal_error'},error instanceof AppError?error.status:500);}
}
