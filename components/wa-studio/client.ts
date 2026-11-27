import {useState,useRef,useEffect} from 'react';
import {saveState} from './save-state.mjs';
import {MODEL_DEFAULTS} from '../../server/wa/model-catalog.mjs';
import {createModelLoader} from './model-loader.mjs';
import {createAgentReader} from './agent-reader.mjs';
type SaveToken={key:string;revision:number};
type ApiOptions=RequestInit&{sync?:SaveToken[]|false;activity?:string};
export type Agent={id:string;branch_id:string|null;name:string;provider:string;model:string;auth_mode:string;enabled:boolean;prompt:string;delay_seconds:number;groups_enabled:boolean;response_token_limit:number;hourly_limit:number;context_chars:number;revision:number;whapi_status:string;keys:Record<string,boolean>};
export const providers=[{id:'openai',name:'ChatGPT',mark:'◉'},{id:'gemini',name:'Gemini',mark:'✦'}];
export const defaults:Record<string,string>=MODEL_DEFAULTS;
export class ApiError extends Error{status:number;code:string;constructor(message:string,status:number,code=''){super(message);this.status=status;this.code=code;}}
export async function api(path:string,options:ApiOptions={}):Promise<any>{
 const {sync,activity,...request}=options,method=(request.method||'GET').toUpperCase();
 const mutation=!['GET','HEAD'].includes(method)&&!/(?:^|\/)(test|audio)$/.test(path);
 const tokens=sync===false?[]:sync??(mutation?[saveState.dirty(path)]:[]);
 const operation=tokens.length||activity?saveState.begin(tokens,activity||(/\/whapi\//.test(path)?'Обновляем…':'Сохраняем…')):null;
 try{
  const csrf:Record<string,string>=method==='GET'||method==='HEAD'?{}:{'x-asc-request':'1'};
  const r=await fetch('/api/wa/'+path,{credentials:'same-origin',...request,headers:request.body instanceof FormData?csrf:{'content-type':'application/json',...csrf,...(request.headers as Record<string,string>|undefined)}});
  let d:any;try{d=await r.json();}catch{throw new ApiError(r.status===401?'Войдите в систему.':r.status===403?'Доступ закрыт.':'Сервер вернул некорректный ответ. Повторите действие.',r.status);}
  if(!r.ok)throw new ApiError(d?.error||'Не удалось выполнить действие.',r.status,d?.code);
  const partial=d.results?.some((item:any)=>item.status==='error');if(operation!==null)saveState.finish(operation,tokens,partial?'Некоторые файлы не удалось сохранить.':null);return d;
 }catch(error){if(operation!==null)saveState.finish(operation,tokens,error instanceof Error?error.message:'Проверьте соединение.');throw error;}
}
export async function fileText(file:File){
 const reading=saveState.begin([],'Загружаем файл…');try{
 if(file.size>15*1024*1024)throw new Error('Файл должен быть меньше 15 МБ.');const ext=file.name.split('.').at(-1)?.toLowerCase();
 if(['txt','md','csv','json'].includes(ext||''))return await file.text();
 if(ext==='docx'){const m=await import('mammoth/mammoth.browser');return (await m.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
 if(ext==='pdf'){const p=await import('pdfjs-dist/legacy/build/pdf.mjs'),w=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');p.GlobalWorkerOptions.workerSrc=w.default;const task=p.getDocument({data:new Uint8Array(await file.arrayBuffer())});try{const pdf=await task.promise;if(pdf.numPages>150)throw new Error('Разделите PDF на части до 150 страниц.');let text='';for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);text+=(await page.getTextContent()).items.map((t:any)=>t.str??'').join(' ')+'\n\n';}if(!text.trim())throw new Error('В PDF нет текста. Добавьте распознанную версию.');return text;}finally{await task.destroy();}}
 throw new Error('Поддерживаются PDF, DOCX, TXT, Markdown, CSV и JSON.');
 }finally{saveState.finish(reading,[]);}
}
export function useDesk(){
 const [branches,setBranches]=useState<{id:string;name:string}[]>([]),[agents,setAgents]=useState<Agent[]>([]),[agent,setAgent]=useState<Agent|null>(null),[plan,setPlan]=useState(false),[loading,setLoading]=useState(true),[failure,setFailure]=useState(''),[signInRequired,setSignInRequired]=useState(false);
 const [docs,setDocs]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[usage,setUsage]=useState<any>({requests:0,input_tokens:0,output_tokens:0}),[errors,setErrors]=useState<any[]>([]),[catalog,setCatalog]=useState<any>({agentId:'',provider:'',models:[],loading:false,error:null});
 const [toast,setToast]=useState(''),[busy,setBusy]=useState(''),[modal,setModal]=useState<string|null>(null),[whapi,setWhapiState]=useState(''),[ai,setAiState]=useState('');
 const whapiDraft=useRef(''),aiDraft=useRef(''),whapiTimer=useRef<ReturnType<typeof setTimeout>|null>(null),aiTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function setWhapi(value:string,edited=true){whapiDraft.current=value;setWhapiState(value);if(edited&&latest.current){const key=`agents/${latest.current.id}/credentials/whapi`;value.trim()?saveState.dirty(key):saveState.discard(key);}}
 function setAi(value:string,edited=true){aiDraft.current=value;setAiState(value);if(edited&&latest.current){const key=`agents/${latest.current.id}/credentials/${latest.current.provider}`;value.trim()?saveState.dirty(key):saveState.discard(key);}}
 function cancelTokenTimers(){if(whapiTimer.current)clearTimeout(whapiTimer.current);if(aiTimer.current)clearTimeout(aiTimer.current);}
 const modelLoader=useRef<ReturnType<typeof createModelLoader>|null>(null);
 if(!modelLoader.current)modelLoader.current=createModelLoader((agentId:string,provider:string)=>api(`agents/${agentId}/models?provider=${provider}`,{activity:'Обновляем модели…'}).catch(error=>{lostAccess(error);throw error;}),setCatalog);
 const catalogMatches=catalog.agentId===agent?.id&&catalog.provider===agent?.provider;
 const models=catalogMatches?catalog.models:[],modelLoading=!!agent&&(!catalogMatches||catalog.loading),modelError=catalogMatches?catalog.error:null;
 useEffect(()=>()=>modelLoader.current?.invalidate(),[]);
 const latest=useRef<Agent|null>(null),selection=useRef(''),loadEpoch=useRef(0),queue=useRef<Promise<unknown>>(Promise.resolve()),promptTimer=useRef<ReturnType<typeof setTimeout>|null>(null),draftPrompt=useRef<string|null>(null),reads=useRef(createAgentReader());
 function clearDetails(){setDocs([]);setUsers([]);setUsage({requests:0,input_tokens:0,output_tokens:0});setErrors([]);}
 function lostAccess(error:unknown){if(!(error instanceof ApiError)||![401,403].includes(error.status))return false;reads.current.clear();modelLoader.current?.invalidate();selection.current='';loadEpoch.current++;latest.current=null;draftPrompt.current=null;cancelTokenTimers();if(promptTimer.current)clearTimeout(promptTimer.current);setAgent(null);setAgents([]);clearDetails();setWhapi('',false);setAi('',false);setModal(null);setSignInRequired(error.status===401);setFailure(error.message);setLoading(false);return true;}
 function accept(a:Agent){if(selection.current!==a.id||latest.current?.id===a.id&&latest.current.revision>a.revision)return;latest.current=a;setAgent(draftPrompt.current!==null?{...a,prompt:draftPrompt.current}:a);setAgents(old=>old.some(x=>x.id===a.id)?old.map(x=>x.id===a.id?a:x):[...old,a]);}
 function applyDetails(data:any){accept(data.agent);setDocs(data.documents);setUsers(data.users);setUsage(data.usage);setErrors(data.errors);}
 async function load(id:string){const epoch=++loadEpoch.current;selection.current=id;reads.current.select(id);latest.current=null;setAgent(null);clearDetails();setLoading(true);setFailure('');setWhapi('',false);setAi('',false);try{await reads.current.read(id,(signal:AbortSignal)=>api('agents/'+id,{signal}),applyDetails);}catch(error){if(!lostAccess(error)){setFailure(error instanceof Error?error.message:'Не удалось загрузить агента.');throw error;}}finally{if(epoch===loadEpoch.current)setLoading(false);}}
 async function refreshAgent(id:string){if(selection.current!==id)return;try{await reads.current.read(id,(signal:AbortSignal)=>api('agents/'+id,{signal}),applyDetails);}catch(error){lostAccess(error);throw error;}}
 async function boot(){try{const d=await api('bootstrap');setAgents(d.agents);setBranches(d.branches??[]);setPlan(d.chatgptPlan);if(d.agents.length)await load(d.agents[0].id);}catch(e:any){if(!lostAccess(e))setFailure(e.message);}finally{setLoading(false);}}
 useEffect(()=>{boot();},[]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),6500);return()=>clearTimeout(id);},[toast]);
 function update(patch:Partial<Agent>,pending?:SaveToken[]){const target=latest.current;if(!target||selection.current!==target.id)return Promise.resolve(false);reads.current.invalidate();const sync=pending??Object.keys(patch).map(field=>saveState.dirty(`agents/${target.id}/${field}`));setAgent(a=>a?{...a,...patch}:a);const task=queue.current.catch(()=>{}).then(async()=>{const a=latest.current;if(!a||a.id!==target.id||selection.current!==target.id)return false;try{const d=await api(`agents/${a.id}`,{method:'PATCH',body:JSON.stringify({...patch,expectedRevision:a.revision}),sync});accept(d.agent);return true;}catch(e:any){if(lostAccess(e))return false;if(typeof patch.prompt==='string'&&draftPrompt.current===null&&sync.some(t=>t.key===`agents/${a.id}/prompt`&&saveState.current(t.key)?.revision===t.revision))draftPrompt.current=patch.prompt;setToast(e.message);await refreshAgent(a.id).catch(()=>{});return false;}});queue.current=task;return task;}
 function prompt(value:string){if(latest.current)saveState.dirty(`agents/${latest.current.id}/prompt`);draftPrompt.current=value;setAgent(a=>a?{...a,prompt:value}:a);if(promptTimer.current)clearTimeout(promptTimer.current);promptTimer.current=setTimeout(()=>{draftPrompt.current=null;update({prompt:value},latest.current?[saveState.current(`agents/${latest.current.id}/prompt`)].filter(Boolean) as SaveToken[]:undefined);},700);}
 async function flush(){const target=selection.current;if(promptTimer.current){clearTimeout(promptTimer.current);promptTimer.current=null;}if(draftPrompt.current!==null){const value=draftPrompt.current;draftPrompt.current=null;update({prompt:value},latest.current?[saveState.current(`agents/${latest.current.id}/prompt`)].filter(Boolean) as SaveToken[]:undefined);}const saved=await queue.current;const fields=target?saveState.pending(`agents/${target}/`).filter(field=>!field.key.includes('/credentials/')&&!field.key.includes('/files/')):[];if(target&&selection.current!==target||draftPrompt.current!==null||saved===false||fields.some(field=>field.phase==='error'))throw new Error('Не удалось сохранить изменения. Повторите сохранение перед переключением.');}
 async function token(provider:string,value:string){const target=latest.current;if(!target||!value.trim())return;const scope=`agents/${target.id}/credentials/${provider}`,sync=[saveState.current(scope)||saveState.dirty(scope)];await flush();reads.current.invalidate();const task=queue.current.catch(()=>{}).then(async()=>{try{const d=await api(`agents/${target.id}/credentials`,{method:'POST',body:JSON.stringify({provider,token:value.trim()}),sync});if(selection.current===target.id){accept(d.agent);if(provider==='whapi'&&whapiDraft.current===value)setWhapi('',false);if(provider!=='whapi'&&aiDraft.current===value)setAi('',false);if(provider!=='whapi')await modelLoader.current!.load(target.id,provider);}}catch(error){lostAccess(error);throw error;}});queue.current=task.catch(()=>{});return task;}
 async function saveTokens(){cancelTokenTimers();const w=whapiDraft.current,k=aiDraft.current,provider=latest.current?.provider;await flush();if(w)await token('whapi',w);if(k&&provider)await token(provider,k);await queue.current;}
 useEffect(()=>{if(!whapi.trim())return;whapiTimer.current=setTimeout(()=>token('whapi',whapi).catch(e=>setToast(e.message)),1100);return()=>{if(whapiTimer.current)clearTimeout(whapiTimer.current);};},[whapi]);
 useEffect(()=>{if(!ai.trim()||!agent)return;aiTimer.current=setTimeout(()=>token(agent.provider,ai).catch(e=>setToast(e.message)),1100);return()=>{if(aiTimer.current)clearTimeout(aiTimer.current);};},[ai,agent?.provider]);
 async function refreshModels(){if(agent)await modelLoader.current!.load(agent.id,agent.provider);}
 useEffect(()=>{if(agent)modelLoader.current!.load(agent.id,agent.provider);},[agent?.id,agent?.provider,agent?.auth_mode,agent?.keys?.openai,agent?.keys?.gemini]);
 useEffect(()=>{if(!agent)return;const t=setInterval(()=>{if(saveState.pending(`agents/${agent.id}/`).length)return;refreshAgent(agent.id).catch(()=>{});},15000);return()=>clearInterval(t);},[agent?.id]);
 useEffect(()=>()=>{reads.current.clear();cancelTokenTimers();if(promptTimer.current)clearTimeout(promptTimer.current);},[]);
 const working=useRef(false);
 async function work(name:string,task:()=>Promise<unknown>){if(working.current)return;working.current=true;setBusy(name);try{await task();}catch(e:any){lostAccess(e);setToast(e.message);}finally{working.current=false;setBusy('');}}
 async function create(name:string,branchId:string|null=null){await saveTokens();const d=await api('agents',{method:'POST',body:JSON.stringify({name:name||'Новый агент',branch_id:branchId})});await load(d.agent.id);setModal(null);}
 async function select(id:string){await work('select',async()=>{await saveTokens();draftPrompt.current=null;setModal(null);await load(id);});}
 async function selectProvider(provider:string){if(!latest.current||provider===latest.current.provider)return;await work('provider',async()=>{await saveTokens();await update({provider,model:defaults[provider],auth_mode:'key'});});}
 async function check(){if(!agent)return;await work('whapi',async()=>{await saveTokens();let d;try{d=await api(`agents/${agent.id}/whapi/check`,{method:'POST',body:'{}'});}catch(error){await refreshAgent(agent.id);throw error;}accept(d.agent);setToast(d.connected?'WhatsApp подключён.':(d.message||'WhatsApp пока не подключён. Проверьте номер в кабинете Whapi.'));});}
 async function toggle(){if(!agent)return;await work('toggle',async()=>{await saveTokens();if(!latest.current?.enabled){const checked=await api(`agents/${agent.id}/whapi/check`,{method:'POST',body:'{}'});accept(checked.agent);if(!checked.connected)throw new Error(checked.message||'Подключите WhatsApp в кабинете Whapi.');}await update({enabled:!latest.current?.enabled});});}
 return {branches,agents,agent,plan,loading,failure,signInRequired,docs,users,usage,errors,models,modelLoading,modelError,toast,busy,modal,whapi,ai,setModal,setToast,setWhapi,setAi,refreshAgent,update,prompt,flush,refreshModels,work,create,select,selectProvider,check,toggle};
}
