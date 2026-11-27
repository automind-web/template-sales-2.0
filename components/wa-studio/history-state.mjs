export function mergeHistory(current,page){
 if(!page.length)return {messages:[],resetPagination:true};
 const boundary=page[0],index=current.findIndex(message=>message.id===boundary.id);
 // With no overlap, keeping the old prefix could hide a gap larger than a page.
 // Restart from the new page so its server cursor can load the missing messages.
 if(index<0)return {messages:page,resetPagination:true};
 return {messages:[...current.slice(0,index),...page],resetPagination:false};
}
