'use client';
import {useEffect,useRef,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {LoaderCircle,AlertCircle} from 'lucide-react';
import {saveState} from './save-state.mjs';

export default function SaveStatus(){
 const state=useSyncExternalStore(saveState.subscribe,saveState.getSnapshot,saveState.getSnapshot),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const element=ref.current;if(!element||state.kind==='idle')return;if(typeof element.showPopover==='function'){if(element.matches(':popover-open'))element.hidePopover();element.showPopover();}else element.removeAttribute('popover');},[state.revision]);
 if(state.kind==='idle')return null;
 return createPortal(<div className="wa-studio wa-portal"><div ref={ref} popover="manual" className={'save-status '+state.kind} role="status" aria-live="polite" aria-atomic="true" title={state.detail||state.text}>
  {state.kind==='saving'?<LoaderCircle size={14} className="spin"/>:state.kind==='error'?<AlertCircle size={14}/>:<span className="save-status-dot"/>}<span>{state.text}</span>
 </div></div>,document.body);
}
