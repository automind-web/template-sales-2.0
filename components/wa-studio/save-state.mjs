// Each field keeps its own revision: an older response cannot acknowledge a newer draft.
export function createSaveState(){
 const fields=new Map(),active=new Map(),listeners=new Set();let revision=0,touched=false;
 let snapshot={kind:'idle',text:'',detail:'',revision:0};
 function publish(){
  const entries=[...fields.values()],failed=entries.find(e=>e.phase==='error');
  const running=[...active.values()].at(-1);
  const next=running?{kind:'saving',text:running.label,detail:''}:failed?{kind:'error',text:'Не сохранено',detail:failed.detail}:entries.length?{kind:'dirty',text:'Не сохранено',detail:'Изменения ожидают сохранения.'}:{kind:touched?'saved':'idle',text:touched?'Сохранено':'',detail:''};
  snapshot={...next,revision:++revision};for(const listener of listeners)listener();
 }
 function dirty(key){const token={key,revision:++revision};fields.set(key,{...token,phase:'dirty'});touched=true;publish();return token;}
 function discard(key){if(fields.delete(key))publish();}
 function begin(tokens,label='Сохраняем…'){
  const operation=++revision;active.set(operation,{label});if(tokens.length)touched=true;
  for(const token of tokens)if(fields.get(token.key)?.revision===token.revision)fields.set(token.key,{...token,phase:'saving'});
  publish();return operation;
 }
 /** @param {number} operation @param {{key:string,revision:number}[]} tokens @param {string|null} error */
 function finish(operation,tokens,error=null){
  active.delete(operation);
  for(const token of tokens){if(fields.get(token.key)?.revision!==token.revision)continue;if(error)fields.set(token.key,{...token,phase:'error',detail:String(error)});else fields.delete(token.key);}
  publish();
 }
 return {dirty,discard,begin,finish,current:key=>fields.get(key),pending:prefix=>[...fields.values()].filter(field=>field.key.startsWith(prefix)),getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
}
export const saveState=createSaveState();
