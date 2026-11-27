// Only the latest requested agent/provider may publish a catalog or finish its spinner.
export function createModelLoader(request,onChange){
 let version=0;
 return {
  async load(agentId,provider){
   const current=++version;onChange({agentId,provider,models:[],loading:true,error:null});
   try{const result=await request(agentId,provider);if(current===version)onChange({agentId,provider,models:result.models,loading:false,error:null});}
   catch(error){if(current===version)onChange({agentId,provider,models:[],loading:false,error:error instanceof Error?error.message:'Не удалось загрузить модели.'});}
  },
  invalidate(){version++;},
 };
}
