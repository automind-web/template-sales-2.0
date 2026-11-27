'use client';
import {useEffect,useRef,useState} from 'react';
import {UploadCloud,FileText,Check,Copy,AlertCircle,RefreshCw} from 'lucide-react';
import {api,fileText} from './client';
import {saveState} from './save-state.mjs';
type Item={id:string;file:File;status:'waiting'|'reading'|'added'|'duplicate'|'error';error?:string;sync:{key:string;revision:number};operation:number};
export default function FileBatch({agentId,initialFiles=[],onUploaded}:{agentId:string;initialFiles?:File[];onUploaded:()=>Promise<void>}){
 const [items,setItems]=useState<Item[]>([]),[dragging,setDragging]=useState(false);
 const input=useRef<HTMLInputElement>(null),active=useRef(true),queue=useRef(Promise.resolve()),started=useRef(false);
 const patch=(id:string,value:Partial<Item>)=>{if(active.current)setItems(rows=>rows.map(r=>r.id===id?{...r,...value}:r));};
 function add(files:File[]){
  const batch=files.slice(0,50).map(file=>{const sync=saveState.dirty(`agents/${agentId}/files/${file.name}:${file.size}:${file.lastModified}`);return {id:crypto.randomUUID(),file,status:'waiting' as const,sync,operation:saveState.begin([sync],'Загружаем файлы…')};});
  const complete=(itemId:string,error:string|null=null)=>{const item=batch.find(item=>item.id===itemId);if(item)saveState.finish(item.operation,[item.sync],error);};
  setItems(old=>[...old,...batch]);
  queue.current=queue.current.catch(()=>{}).then(async()=>{
   for(let p=0;p<batch.length;p+=5){
    const prepared:({name:string;content:string;byte_size:number;itemId:string})[]=[];
    for(const item of batch.slice(p,p+5)){
     patch(item.id,{status:'reading'});
     try{prepared.push({name:item.file.name,content:await fileText(item.file),byte_size:item.file.size,itemId:item.id});}
     catch(e:any){patch(item.id,{status:'error',error:e.message});complete(item.id,e.message);}
    }
    if(!prepared.length)continue;
    try{
     const result=await api(`agents/${agentId}/documents/files`,{method:'POST',body:JSON.stringify({files:prepared.map(({itemId,...file})=>file)}),sync:false});
     prepared.forEach((file,i)=>{const row=result.results[i];patch(file.itemId,{status:row.status,error:row.error});complete(file.itemId,row.status==='error'?row.error||'Файл не сохранён.':null);});
     await onUploaded();
    }catch(e:any){for(const file of prepared){patch(file.itemId,{status:'error',error:e.message});complete(file.itemId,e.message);}}
   }
  });
 }
 useEffect(()=>{active.current=true;if(!started.current){started.current=true;if(initialFiles.length)add(initialFiles);}return()=>{active.current=false;};},[]);
 return <div className="file-upload-panel"><input ref={input} hidden multiple type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={e=>{if(e.target.files)add(Array.from(e.target.files));e.target.value='';}}/><div role="button" tabIndex={0} aria-label="Выбрать несколько файлов" className={'file-dropzone '+(dragging?'dragging':'')} onClick={()=>input.current?.click()} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.current?.click();}}} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);add(Array.from(e.dataTransfer.files));}}><span className="drop-icon"><UploadCloud size={32}/></span><h3>Перетащите файлы сюда</h3><p>или нажмите, чтобы выбрать несколько файлов</p><small>PDF, DOCX, TXT, MD, CSV, JSON · до 15 МБ на файл</small></div>{!!items.length&&<div className="upload-items" aria-live="polite">{items.map(item=><div className={'upload-item '+item.status} key={item.id}><FileText size={18}/><div><strong>{item.file.name}</strong><small>{item.status==='error'?item.error:item.status==='added'?'Добавлен в базу':item.status==='duplicate'?'Уже есть в базе':item.status==='reading'?'Обрабатываем файл…':'В очереди'}</small></div>{item.status==='added'?<Check size={17}/>:item.status==='duplicate'?<Copy size={15}/>:item.status==='error'?<AlertCircle size={17}/>:<RefreshCw className="spin" size={16}/>}</div>)}</div>}</div>;
}
