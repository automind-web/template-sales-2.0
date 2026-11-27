// WhatsApp Studio внутри системы: доступ, ключи, заявки в CRM и поведение движка
// (сценарии перенесены из тестов шаблона WhatsApp Agent Studio на базу системы).
import assert from 'node:assert/strict';
import test from 'node:test';
import {handleApiRequest} from '../server/router.ts';
import {studioEnv} from '../server/wa/gateway.ts';
import {now} from '../server/wa/vault.mjs';
import {createAgent,setCredential,credential,ownedAgent,first,rows,run,publicAgent,usageLimit} from '../server/wa/store.mjs';
import {ingest,tick,clearConversation} from '../server/wa/engine.mjs';
import {saveDocument,retrieve,deleteDocument} from '../server/wa/knowledge.mjs';
import {bootstrapDirector,createTestEnv,invite} from './support/client.ts';

const message=(id='one',body='Здравствуйте',chat='77010000000@s.whatsapp.net',extra={})=>({id,chat_id:chat,type:'text',text:{body},from_name:'Айгерим',from_me:false,timestamp:Math.floor(now()/1000),...extra});
const due=env=>run(env,'UPDATE jobs SET due_at=0');
const llm=(text='Ответ')=>Response.json({output:[{content:[{type:'output_text',text}]}],usage:{input_tokens:20,output_tokens:4}});
function fake({bodies=[],sent=[]}={}){return async(url,opts={})=>{const u=String(url);if(u.includes('/responses')){bodies.push(JSON.parse(opts.body));return llm('Доставка по городу — 1 день.');}if(u.includes('/messages/text')){sent.push(JSON.parse(opts.body));return Response.json({message:{id:'sent-'+sent.length}});}throw new Error('Unexpected external request: '+u);};}

async function company(){
 const base=createTestEnv();const director=await bootstrapDirector(base);
 const branch=(await director.post('/api/branches',{name:'Центральная'})).body.branch.id;
 const companyId=(base.DB.sqlite.prepare('SELECT id FROM companies').get()).id;
 return {base,director,branch,companyId,env:await studioEnv(base,'https://sales.example')};
}
async function connectedAgent(env,companyId,branchId){
 let a=await createAgent(env,companyId,'Консультант',{branchId,company:'Тестовая компания'});
 await setCredential(env,a,'openai','test-key-openai-private');await setCredential(env,a,'whapi','test-key-whapi-private');
 await run(env,"UPDATE agents SET enabled=1,whapi_status='connected' WHERE id=?",a.id);return ownedAgent(env,companyId,a.id);
}

test('студия: только директор, защита от подделки запросов, филиалы и стартовая инструкция',async()=>{
 const {base,director,branch}=await company();
 const manager=await invite(base,director,{role:'manager',branchId:branch},'manager');
 const employee=await invite(base,manager,{role:'employee'},'ivan');
 assert.equal((await manager.get('/api/wa/bootstrap')).status,403,'руководителю студия закрыта');
 assert.equal((await employee.get('/api/wa/bootstrap')).status,403);
 assert.equal((await director.request('POST','/api/wa/agents',{name:'X'},{csrf:false})).status,403,'запрос без заголовка защиты отклоняется');
 const boot=await director.get('/api/wa/bootstrap');
 assert.equal(boot.status,200);assert.deepEqual(boot.body.branches.map(b=>b.name),['Центральная']);
 const created=await director.post('/api/wa/agents',{name:'Консультант',branch_id:branch});
 assert.equal(created.status,201);assert.equal(created.body.agent.branch_id,branch);
 assert.match(created.body.agent.prompt,/компании «Тестовая компания»/,'стартовая инструкция с названием компании');
 assert.match(created.body.agent.prompt,/только из базы знаний/);
 assert.equal((await director.post('/api/wa/agents',{name:'Y',branch_id:'чужой'})).status,404,'чужой филиал не принимается');
});

test('ключи: шифруются ключом сайта без настройки, в браузер не возвращаются',async()=>{
 const {director,branch,base}=await company();
 const agent=(await director.post('/api/wa/agents',{name:'Консультант',branch_id:branch})).body.agent;
 const saved=await director.post(`/api/wa/agents/${agent.id}/credentials`,{provider:'openai',token:'sk-test-private-key-123'});
 assert.equal(saved.status,200);assert.equal(saved.body.agent.keys.openai,true);
 assert.ok(!JSON.stringify(saved.body).includes('sk-test-private-key-123'));
 const raw=base.DB.sqlite.prepare("SELECT value FROM credentials WHERE provider='openai'").get();
 assert.ok(!raw.value.includes('sk-test'),'в базе ключ зашифрован');
 assert.equal(base.DB.sqlite.prepare('SELECT count(*) AS n FROM vault_keys').get().n,1,'ключ шифрования создан автоматически');
 const read=await director.get(`/api/wa/agents/${agent.id}`);
 assert.ok(!JSON.stringify(read.body).includes('sk-test-private-key-123'));
});

test('новый собеседник становится заявкой в CRM филиала; повтор и группы заявок не плодят',async()=>{
 const {env,companyId,branch,director}=await company();
 const a=await connectedAgent(env,companyId,branch);
 await ingest(env,a,message('m1','Сколько стоит доставка?'));
 await ingest(env,a,message('m1','Сколько стоит доставка?'));
 await ingest(env,a,message('m2','И самовывоз?'));
 await ingest(env,a,message('g1','Привет всем','120363000000000000@g.us'));
 const leads=(await rows(env,'SELECT source,owner_user_id,client_phone,client_name,branch_id FROM leads')).map(row=>({...row}));
 assert.deepEqual(leads,[{source:'whatsapp',owner_user_id:null,client_phone:'+77010000000',client_name:'Айгерим',branch_id:branch}]);
 const conv=await first(env,"SELECT lead_id FROM conversations WHERE chat_id='77010000000@s.whatsapp.net'");
 assert.ok(conv.lead_id,'переписка связана с заявкой');
 const crm=await director.get(`/api/crm/leads?branchId=${branch}`);
 assert.equal(crm.body.leads[0].source,'whatsapp','заявка видна в CRM');
 const noBranch=await createAgent(env,companyId,'Без филиала');
 await ingest(env,{...noBranch,enabled:1,whapi_status:'connected'},message('x1','Привет','77019999999@s.whatsapp.net'));
 assert.equal((await rows(env,'SELECT id FROM leads')).length,1,'агент без филиала заявки не создаёт');
});

test('движок: повтор доставки — один ответ, ответ идёт по базе знаний, ключи не уходят в подсказку',async()=>{
 const {env,companyId,branch}=await company();
 const a=await connectedAgent(env,companyId,branch);
 await saveDocument(env,a,{name:'Доставка.txt',content:'Доставка по городу занимает 1 день.',byte_size:60});
 const fresh=await ownedAgent(env,companyId,a.id);
 assert.match((await retrieve(env,fresh,'доставка')).context,/1 день/);
 const bodies=[],sent=[];
 await Promise.all([ingest(env,fresh,message('d1','Сколько идёт доставка?')),ingest(env,fresh,message('d1','Сколько идёт доставка?'))]);
 await due(env);await Promise.all([tick(env,{fetcher:fake({bodies,sent})}),tick(env,{fetcher:fake({bodies,sent})})]);
 assert.equal(sent.length,1);assert.deepEqual(sent[0],{to:'77010000000@s.whatsapp.net',body:'Доставка по городу — 1 день.',no_link_preview:true});
 assert.match(bodies[0].instructions,/Доставка по городу занимает 1 день/);
 assert.ok(!JSON.stringify(bodies[0]).includes('test-key'),'ключи не попадают в запрос к нейросети');
});

test('движок: ответ человека передаёт диалог человеку; очистка истории; лимит в час',async()=>{
 const {env,companyId,branch}=await company();
 const a=await connectedAgent(env,companyId,branch);const sent=[];
 await ingest(env,a,message());await ingest(env,a,{...message('op','Сейчас помогу'),from_me:true,source:'web'});
 await due(env);await tick(env,{fetcher:fake({sent})});
 assert.equal(sent.length,0);assert.equal((await first(env,'SELECT handoff FROM conversations')).handoff,1);
 const c=await first(env,'SELECT id FROM conversations');await clearConversation(env,a,c.id);
 assert.equal((await first(env,'SELECT count(*) AS n FROM messages')).n,0);
 const limited={...a,hourly_limit:2};const r=await Promise.allSettled(Array.from({length:6},()=>usageLimit(env,limited)));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
});

test('приём сообщений: адрес студии с секретом; чужой секрет отклоняется',async()=>{
 const {base,env,companyId,branch}=await company();
 const a=await connectedAgent(env,companyId,branch);
 await setCredential(env,a,'webhook','webhook-secret-for-tests-123');
 const post=(secret)=>handleApiRequest(new Request(`https://sales.example/api/wa/webhooks/whapi/${a.id}`,{method:'POST',headers:{'content-type':'application/json','x-webhook-secret':secret,'cf-connecting-ip':'10.70.0.1'},body:JSON.stringify({messages:[message('w1','Привет')]})}),base);
 assert.equal((await post('wrong-secret-value-123')).status,401);
 assert.equal((await first(env,'SELECT count(*) AS n FROM messages')).n,0);
 const ok=await post('webhook-secret-for-tests-123');
 assert.ok([200,503].includes(ok.status),'сообщение принято (503 — ответ ещё в очереди, Whapi повторит)');
 assert.equal((await first(env,"SELECT count(*) AS n FROM messages WHERE role='user'")).n,1);
 assert.equal((await rows(env,'SELECT id FROM leads')).length,1);
 const doc=await saveDocument(env,a,{name:'Цены.txt',content:'Торт 7000 тенге.',byte_size:20});
 await deleteDocument(env,await ownedAgent(env,companyId,a.id),doc.id);
 assert.equal((await retrieve(env,await ownedAgent(env,companyId,a.id),'торт')).context,'');
 assert.ok(!JSON.stringify(await publicAgent(env,a)).includes('webhook-secret'));
 assert.equal(await credential(env,a,'webhook'),'webhook-secret-for-tests-123');
});
