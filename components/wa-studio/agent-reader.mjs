// Reads belong to one selection and one request. Leaving A for B (or A again)
// invalidates requests already in flight, including transports that ignore abort.
export function createAgentReader(){
 let selected=null,version=0,controller=null;
 function invalidate(){version++;controller?.abort();controller=null;}
 return {
  select(id){invalidate();selected=id;},
  invalidate,
  clear(){invalidate();selected=null;},
  async read(id,request,apply){
   if(id!==selected)return false;
   invalidate();const turn=version,own=new AbortController();controller=own;
   try{const result=await request(own.signal);if(own.signal.aborted||selected!==id||version!==turn)return false;apply(result);return true;}
   catch(error){if(own.signal.aborted||selected!==id||version!==turn)return false;throw error;}
   finally{if(controller===own)controller=null;}
  },
 };
}
