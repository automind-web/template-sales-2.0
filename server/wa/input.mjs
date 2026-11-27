import {AppError} from './vault.mjs';

export async function jsonBody(request,maxBytes=500000){
 const declared=Number(request.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maxBytes)throw new AppError('Слишком много данных.',413,'request_too_large');
 const reader=request.body?.getReader();
 if(!reader)throw new AppError('Некорректный запрос.');
 const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError('Слишком много данных.',413,'request_too_large');}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();
  const data=JSON.parse(text);
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('Некорректный запрос.');
  return data;
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('Некорректный запрос.');}
 finally{reader.releaseLock();}
}
