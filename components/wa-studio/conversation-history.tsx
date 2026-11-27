'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlertCircle,ArrowUp,MessageSquare,Mic,RefreshCw,Users,UserRound} from 'lucide-react';
import {api,ApiError} from './client';
import {mergeHistory} from './history-state.mjs';

type Message={id:string;role:string;sender:'user'|'agent'|'operator';type:string;content:string;transcript:string|null;translation:string|null;created_at:number};
type Conversation={id:string;name:string;chat_id:string;is_group:boolean;epoch:number};
type Page={knowledgeVersion:number;conversation:Conversation;messages:Message[];hasMore:boolean;nextCursor:string|null};
export default function ConversationHistory({agentId,user}:{agentId:string;user:{id:string;name:string;chat_id:string;is_group?:boolean}}){
 const [messages,setMessages]=useState<Message[]>([]),[conversation,setConversation]=useState<Conversation|null>(null);
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[olderLoading,setOlderLoading]=useState(false),[error,setError]=useState(''),[hasMore,setHasMore]=useState(false),[denied,setDenied]=useState(false);
 const scroll=useRef<HTMLDivElement>(null),follow=useRef(true),restoreHeight=useRef<number|null>(null),epoch=useRef<number|null>(null),cursor=useRef<string|null>(null),knowledgeVersion=useRef<number|null>(null);
 const lifetime=useRef<AbortController|null>(null),refreshBusy=useRef(false),olderBusy=useRef(false);
 const currentMessages=useRef<Message[]>([]);
 const path=`agents/${agentId}/users/${user.id}/history`;
 const latest=useCallback(async()=>{
  const controller=lifetime.current;if(!controller||controller.signal.aborted||refreshBusy.current)return;
  refreshBusy.current=true;setRefreshing(true);
  try{
   const page:Page=await api(path,{signal:controller.signal});if(controller.signal.aborted)return;
   const reset=epoch.current!==page.conversation.epoch||knowledgeVersion.current!==page.knowledgeVersion;knowledgeVersion.current=page.knowledgeVersion;
   const merged=reset?{messages:page.messages,resetPagination:true}:mergeHistory(currentMessages.current,page.messages);
   if(reset||merged.resetPagination){epoch.current=page.conversation.epoch;cursor.current=page.nextCursor;setHasMore(page.hasMore);if(reset)follow.current=true;}
   currentMessages.current=merged.messages;setMessages(merged.messages);
   setConversation(page.conversation);setError('');setDenied(false);
  }catch(e:any){if(!controller.signal.aborted){setError(e.message);if(e instanceof ApiError&&[401,403,404].includes(e.status)){currentMessages.current=[];setMessages([]);setConversation(null);setHasMore(false);cursor.current=null;setDenied(true);}}}
  finally{if(lifetime.current===controller)refreshBusy.current=false;if(!controller.signal.aborted){setLoading(false);setRefreshing(false);}}
 },[path]);
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;epoch.current=null;cursor.current=null;follow.current=true;refreshBusy.current=false;olderBusy.current=false;
  currentMessages.current=[];setMessages([]);setConversation(null);setLoading(true);setError('');setHasMore(false);setDenied(false);latest();
  const timer=setInterval(()=>{if(document.visibilityState!=='hidden')latest();},6000);
  return()=>{clearInterval(timer);controller.abort();};
 },[latest]);
 useLayoutEffect(()=>{const element=scroll.current;if(!element)return;if(restoreHeight.current!==null){element.scrollTop+=element.scrollHeight-restoreHeight.current;restoreHeight.current=null;}else if(follow.current)element.scrollTop=element.scrollHeight;},[messages]);
 async function older(){
  const controller=lifetime.current,before=cursor.current,requestedEpoch=epoch.current;
  if(!controller||controller.signal.aborted||!before||requestedEpoch===null||olderBusy.current)return;
  olderBusy.current=true;setOlderLoading(true);
  try{
   const page:Page=await api(`${path}?before=${encodeURIComponent(before)}&epoch=${requestedEpoch}`,{signal:controller.signal});
   if(controller.signal.aborted||epoch.current!==requestedEpoch||cursor.current!==before)return;
   if(page.knowledgeVersion!==knowledgeVersion.current){await latest();return;}
   restoreHeight.current=scroll.current?.scrollHeight??null;follow.current=false;
   const existing=new Set(currentMessages.current.map(message=>message.id));currentMessages.current=[...page.messages.filter(message=>!existing.has(message.id)),...currentMessages.current];setMessages(currentMessages.current);
   cursor.current=page.nextCursor;setHasMore(page.hasMore);setError('');
  }catch(e:any){if(!controller.signal.aborted){setError(e.message);if(e instanceof ApiError&&[401,403,404].includes(e.status)){currentMessages.current=[];setMessages([]);setConversation(null);setHasMore(false);cursor.current=null;setDenied(true);}else await latest();}}
  finally{if(lifetime.current===controller)olderBusy.current=false;if(!controller.signal.aborted)setOlderLoading(false);}
 }
 const profile=conversation??user;
 if(denied)return <div className="history-empty" role="alert"><AlertCircle size={24}/><p>{error||'История недоступна.'}</p><button className="secondary small" onClick={latest}>Повторить проверку</button></div>;
 let previousDate='';
 return <div className="history-layout">
  <div className="history-profile"><div className="history-avatar">{profile.is_group?<Users size={22}/>:<UserRound size={22}/>}</div><div className="history-profile-copy"><h3>{profile.name}</h3><span>{profile.is_group?'Группа · ':''}{profile.chat_id.replace(/@.*/,'')}</span></div><button className="secondary small history-refresh" disabled={refreshing} onClick={latest}><RefreshCw size={14} className={refreshing?'spin':''}/>Обновить</button></div>
  {error&&<div className="history-error" role="alert"><AlertCircle size={15}/><span>{error}</span></div>}
  <div ref={scroll} className="history-messages" aria-label="Сообщения переписки" aria-busy={loading} onScroll={()=>{const element=scroll.current;if(element)follow.current=element.scrollHeight-element.clientHeight-element.scrollTop<90;}}>
   {loading?<div className="history-empty"><RefreshCw size={24} className="spin"/><p>Загружаем переписку…</p></div>:!messages.length?<div className="history-empty"><span className="history-empty-icon"><MessageSquare size={30}/></span><h3>{error?'Не удалось загрузить историю':'Переписки пока нет'}</h3><p>{error?'Нажмите «Обновить», чтобы повторить.':'Здесь появятся сообщения, полученные системой.'}</p></div>:<>
    {hasMore&&<div className="history-older"><button className="secondary small" disabled={olderLoading} onClick={older}>{olderLoading?<RefreshCw size={13} className="spin"/>:<ArrowUp size={13}/>}Ранние сообщения</button></div>}
    {messages.map(message=>{const date=new Date(message.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),divider=date!==previousDate;previousDate=date;const voice=['voice','audio'].includes(message.type);return <div key={message.id}>
     {divider&&<div className="history-day"><span>{date}</span></div>}
     <article className={'history-message '+(message.role==='user'?'incoming':'outgoing')+' '+message.sender}>
      <div className="history-author">{message.sender==='agent'?'Агент':message.sender==='operator'?'Оператор':profile.is_group?'Участник группы':'Собеседник'}</div>
      {voice&&<div className="history-voice"><Mic size={13}/>Голосовое сообщение</div>}
      <p>{voice?message.transcript||message.content:message.content}</p>
      {message.translation&&message.translation!==message.transcript&&<div className="history-translation"><span>Перевод на русский</span><p>{message.translation}</p></div>}
      <time dateTime={new Date(message.created_at).toISOString()}>{new Date(message.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time>
     </article>
    </div>;})}
   </>}
  </div>
  <div className="history-footer"><span className="history-footer-dot"/>История обновляется автоматически</div>
 </div>;
}
