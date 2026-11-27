import {AppError,now,sha,randomToken} from './vault.mjs';
import {first,run,credential,setCredential,publicAgent,cancelAgentJobs} from './store.mjs';

async function callWhapi(path,key,options={},fetcher=fetch){
 let response;try{response=await fetcher(`https://gate.whapi.cloud/${path}`,{...options,headers:{authorization:`Bearer ${key}`,'content-type':'application/json',...options.headers},redirect:'manual',signal:AbortSignal.timeout(25000)});}catch{throw new AppError('Whapi не ответил. Повторите проверку подключения.',502,'whapi_unavailable');}
 if(!response.ok){const status=response.status;await response.body?.cancel();throw new AppError(status===401||status===403?'Whapi не принял ключ. Нужен ключ канала из кабинета Whapi, а не ключ ChatGPT или Gemini.':status===404?'Канал Whapi не найден. Проверьте токен канала.':status===402?'Whapi: проверьте оплату канала.':status===429?'Whapi ограничил запросы. Повторите проверку чуть позже.':'Whapi временно недоступен. Повторите проверку чуть позже.',status<500?400:502,`whapi_${status}`);}
 try{return await response.json();}catch{throw new AppError('Whapi вернул некорректный ответ.',502,'whapi_invalid_response');}
}
const statusMessages={QR:'Отсканируйте QR-код номера в кабинете Whapi.',INIT:'Канал Whapi запускается. Повторите проверку через несколько секунд.',LAUNCH:'Whapi подключается к WhatsApp. Повторите проверку через несколько секунд.',STOP:'Канал Whapi остановлен. Проверьте его состояние и оплату.',SYNC_ERROR:'Ошибка синхронизации WhatsApp. Переподключите номер в Whapi.'};
export async function checkWhapi(env,a,fetcher=fetch){
 const key=await credential(env,a,'whapi');if(!key)throw new AppError('Добавьте ключ WhatsApp из кабинета Whapi.');
 let data;try{data=await callWhapi('health?wakeup=true',key,{},fetcher);}catch(error){await run(env,"UPDATE agents SET whapi_status='error',whapi_checked_at=?,enabled=0 WHERE id=?",now(),a.id);await cancelAgentJobs(env,a.id);throw error;}
 const health=data.health??data,status=String(health.status?.text??health.status??'UNKNOWN').trim().toUpperCase(),connected=status==='AUTH';
 const phone=health.user?.id??health.user?.phone??data.phone??null,channelId=data.channel_id??data.channel?.id??null;
 const hash=await sha(`whapi:${phone||channelId||key}`),other=await first(env,'SELECT id FROM agents WHERE whapi_channel_hash=? AND id<>?',hash,a.id);if(other)throw new AppError('Этот WhatsApp уже используется другим агентом.',409,'channel_in_use');
 await run(env,"UPDATE agents SET whapi_status=?,whapi_identity=?,whapi_channel_hash=?,whapi_checked_at=?,enabled=CASE WHEN ?=1 THEN enabled ELSE 0 END WHERE id=?",connected?'connected':'disconnected',JSON.stringify({phone,channelId,status}),hash,now(),connected?1:0,a.id);
 if(!connected)await cancelAgentJobs(env,a.id);
 return {connected,status,phone,message:connected?'WhatsApp подключён.':statusMessages[status]||'WhatsApp пока не подключён. Проверьте номер в кабинете Whapi.',agent:await publicAgent(env,await first(env,'SELECT * FROM agents WHERE id=?',a.id))};
}
export async function setupWebhook(env,a,fetcher=fetch){
 const publicUrl=env.WEBHOOK_BASE_URL||env.PUBLIC_URL;if(!publicUrl||new URL(publicUrl).protocol!=='https:')throw new AppError('Включить агента можно только на опубликованном сайте (адрес начинается с https://).',409,'https_required');
 const key=await credential(env,a,'whapi');if(!key)throw new AppError('Добавьте ключ WhatsApp из кабинета Whapi.');
 const settings=await callWhapi('settings',key,{},fetcher);
 const url=`${publicUrl.replace(/\/$/,'')}/api/wa/webhooks/whapi/${a.id}`,secret=await credential(env,a,'webhook')||randomToken();
 const hooks=(settings.webhooks??[]).filter(h=>h.url!==url);if(hooks.some(h=>h.events?.some(e=>e.type==='messages')))throw new AppError('В Whapi уже есть другой обработчик сообщений. Сначала проверьте его, чтобы избежать двух ответов.',409,'webhook_conflict');
 await setCredential(env,a,'webhook',secret);
 const preserved=Object.fromEntries(['pdo_sync','media','proxy','proxy_trust_filters','mobile_proxy','offline_mode','full_history','auto_read_messages','locale','mock_pairing_code','ignored_presences','data_mode'].filter(k=>k in settings).map(k=>[k,settings[k]]));
 const headers={'x-webhook-secret':secret};
 await callWhapi('settings',key,{method:'PATCH',body:JSON.stringify({...preserved,callback_persist:true,callback_backoff_delay_ms:3000,max_callback_backoff_delay_ms:600000,webhooks:[...hooks,{url,mode:'body',headers,events:[{type:'messages',method:'post'}]}]})},fetcher);
 return {configured:true,url};
}
