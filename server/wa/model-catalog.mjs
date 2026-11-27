// Ten distinct text models per provider, checked 2026-11-03. Recommendation order
// favors everyday value, then broader capabilities; it is not a benchmark ranking.
// Restricted legacy Gemini models are retained for existing accounts until their
// announced rerouting date. Discovery still intersects this list with account access.
export const MODEL_CATALOG={
 openai:[
  {id:'gpt-6-luna',name:'GPT-6 Luna',purpose:'Экономичная'},
  {id:'gpt-6.1-terra',name:'GPT-6.1 Terra',purpose:'Универсальная'},
  {id:'gpt-6.1-sol',name:'GPT-6.1 Sol',purpose:'Сложные задачи'},
  {id:'gpt-5.6-luna',name:'GPT-5.6 Luna',purpose:'Бюджетная · прежнее поколение'},
  {id:'gpt-5.4-nano',name:'GPT-5.4 Nano',purpose:'Простые массовые задачи'},
  {id:'gpt-5.4-mini',name:'GPT-5.4 Mini',purpose:'Баланс цены и качества'},
  {id:'gpt-5.6-terra',name:'GPT-5.6 Terra',purpose:'Универсальная · прежнее поколение'},
  {id:'gpt-5.4',name:'GPT-5.4',purpose:'Тексты и рабочие задачи'},
  {id:'gpt-5.6-sol',name:'GPT-5.6 Sol',purpose:'Сложные задачи · прежнее поколение'},
  {id:'gpt-6-astra',name:'GPT-6 Astra',purpose:'Максимальное качество · высокая цена'},
 ],
 gemini:[
  {id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash-Lite',purpose:'Экономичная'},
  {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash',purpose:'Универсальная'},
  {id:'gemini-3.1-flash-lite',name:'Gemini 3.1 Flash-Lite',purpose:'Бюджетные массовые задачи'},
  {id:'gemini-2.5-flash-lite',name:'Gemini 2.5 Flash-Lite',purpose:'Минимальная цена · прежние аккаунты'},
  {id:'gemini-3.6-flash',name:'Gemini 3.6 Flash',purpose:'Универсальная · прежнее поколение'},
  {id:'gemini-3-flash-preview',name:'Gemini 3 Flash Preview',purpose:'Баланс цены и качества · Preview'},
  {id:'gemini-4-argon',name:'Gemini 4 Argon',purpose:'Сложные задачи'},
  {id:'gemini-3.1-pro-preview',name:'Gemini 3.1 Pro Preview',purpose:'Глубокий анализ · Preview'},
  {id:'gemini-2.5-flash',name:'Gemini 2.5 Flash',purpose:'Прежние аккаунты · до 30.11.2026',availableBefore:'2026-12-01'},
  {id:'gemini-2.5-pro',name:'Gemini 2.5 Pro',purpose:'Прежняя Pro · до 30.11.2026',availableBefore:'2026-12-01'},
 ],
};
export const MODEL_DEFAULTS={openai:'gpt-6-luna',gemini:'gemini-3.5-flash-lite'};
export function modelRetired(provider,id,at=new Date()){
 const model=MODEL_CATALOG[provider]?.find(model=>model.id===id);
 return Boolean(model?.availableBefore&&new Date(at).toISOString().slice(0,10)>=model.availableBefore);
}
export function curatedModels(provider,available=null,at=new Date()){
 const catalog=MODEL_CATALOG[provider]??[];
 return catalog.filter(model=>!modelRetired(provider,model.id,at)&&(available===null||available.has(model.id))).map(model=>({...model}));
}
