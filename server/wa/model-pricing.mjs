// Public Standard text API rates in USD per 1M tokens, checked 2026-11-03.
// Sources are retained with the data; no Batch, cached-input or audio rates are mixed in.
const OPENAI='https://developers.openai.com/api/docs/pricing';
const GEMINI='https://ai.google.dev/gemini-api/docs/pricing';
export const PRICES_CHECKED_AT='2026-11-03';
const rates={
 'gpt-6-astra':[10,50],
 'gpt-6.1-sol':[2,10],
 'gpt-6.1-terra':[1,5],
 'gpt-6-luna':[0.1,0.5],
 'gpt-5.6-sol':[4,20],
 'gpt-5.6-terra':[2,12],
 'gpt-5.6-luna':[0.2,1.2],
 'gpt-5.4':[2.5,15],
 'gpt-5.4-mini':[0.75,4.5],
 'gpt-5.4-nano':[0.2,1.25],
 'gpt-5-mini':[0.25,2],
 'gpt-5-nano':[0.05,0.4],
 'gpt-4o-mini':[0.15,0.6],
 'gpt-4.1-mini':[0.4,1.6],
 'chat-latest':[5,30],
 'gpt-5.3-codex':[1.75,14],
 'gemini-4-argon':[2,10],
 'gemini-3.8-flash':[0.75,3.75],
 'gemini-3.6-flash':[0.75,3.75],
 'gemini-3.5-flash-lite':[0.3,2.5],
 'gemini-3.1-flash-lite':[0.25,1.5],
 'gemini-3.1-pro-preview':[2,12],
 'gemini-3-flash-preview':[0.5,3],
 'gemini-2.5-flash':[0.3,2.5],
 'gemini-2.5-flash-lite':[0.1,0.4],
 'gemini-2.5-pro':[1.25,10],
};
// Only explicitly documented aliases/snapshots inherit a price. Unknown variants
// (including pro, preview, custom or fine-tuned models) never inherit by prefix.
const aliases={
 'gpt-5.6':'gpt-5.6-sol',
 'gpt-5.4-2026-03-05':'gpt-5.4',
 'gpt-5.4-mini-2026-03-17':'gpt-5.4-mini',
 'gpt-5.4-nano-2026-03-17':'gpt-5.4-nano',
 'gpt-5-mini-2025-08-07':'gpt-5-mini',
 'gpt-5-nano-2025-08-07':'gpt-5-nano',
 'gpt-4o-mini-2024-07-18':'gpt-4o-mini',
 'gpt-4.1-mini-2025-04-14':'gpt-4.1-mini',
 'gemini-3.1-pro-preview-customtools':'gemini-3.1-pro-preview',
};
const amount=value=>'$'+Number(value).toFixed(2);
export function modelPricing(id,at=new Date()){
 const key=Object.hasOwn(aliases,id)?aliases[id]:id,source=key.startsWith('gemini-')?GEMINI:OPENAI;
 if(!Object.hasOwn(rates,key))return {known:false,label:'цена не подтверждена',source,checkedAt:PRICES_CHECKED_AT};
 let [input,output]=rates[key];let note='';const date=new Date(at).toISOString().slice(0,10);
 if(['gemini-2.5-flash','gemini-2.5-pro'].includes(key)){
  if(date>='2026-12-01')return {known:false,label:'модель заменена',source,checkedAt:PRICES_CHECKED_AT,note:'Провайдер заменил модель с 01.12.2026. Выберите актуальную модель.'};
  note='Только ранее использовавшие модель аккаунты; с 01.12.2026 провайдер заменяет модель. Короткий контекст до 200 тыс. токенов.';
 }
 if(key==='gemini-4-argon'){
  if(date>='2026-12-01')[input,output]=[4,20];
  else note='Тариф до 30.11.2026; с 01.12 — $4 / $20.';
 }
 if(['gemini-3.8-flash','gemini-3.6-flash'].includes(key)){
  if(date>='2027-01-01')[input,output]=[1.5,7.5];
  else note='Тариф до 31.12.2026; с 01.01 — $1.50 / $7.50.';
 }
 if(key==='gpt-5.6-sol')note='Промотариф подтверждён как минимум до 21.11.2026.';
 return {known:true,input,output,label:`${amount(input)} / ${amount(output)}`,currency:'USD',perTokens:1000000,source,checkedAt:PRICES_CHECKED_AT,note};
}
