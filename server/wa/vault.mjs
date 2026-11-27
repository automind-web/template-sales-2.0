const enc=new TextEncoder();
export class AppError extends Error{constructor(message,status=400,code='invalid_request'){super(message);this.status=status;this.code=code;}}
export const id=()=>crypto.randomUUID();
export const now=()=>Date.now();
export function b64(bytes){let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s);}
export function unb64(value){return Uint8Array.from(atob(value),x=>x.charCodeAt(0));}
export function randomToken(){return b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export async function sha(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function key(env){if(!env.MASTER_KEY||unb64(env.MASTER_KEY).length!==32)throw new AppError('Не настроен ключ шифрования сервера.',503,'server_setup');return crypto.subtle.importKey('raw',unb64(env.MASTER_KEY),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,value,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},await key(env),enc.encode(value));return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;}
export async function unseal(env,value,aad){if(!value)return null;const [version,iv,cipher]=value.split('.');if(version!=='v1')throw new AppError('Неизвестная версия ключа.',503,'vault_error');try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(aad)},await key(env),unb64(cipher)));}catch{throw new AppError('Не удалось открыть сохранённый ключ.',503,'vault_error');}}
export async function constantEqual(a,b){return await sha(a)===await sha(b);}
export function safeError(error){return error instanceof AppError?error.message:'Не удалось выполнить действие. Повторите попытку.';}
