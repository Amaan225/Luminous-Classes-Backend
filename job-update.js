// A first approval and its alert timestamp must be one document write.
// A second unconditional write could resurrect a lead hidden in between.
async function updateJob(Job,id,changes,{alertsEnabled=false,now=()=>new Date()}={}){
 const safe={...changes};delete safe.alertFirstApprovedAt;delete safe.alertEnqueuedAt;
 if(alertsEnabled&&safe.status==='approved'){
  const first=await Job.findOneAndUpdate({_id:id,status:{$ne:'approved'},alertFirstApprovedAt:{$exists:false}},{$set:{...safe,alertFirstApprovedAt:now()}},{returnDocument:'after',runValidators:true});
  if(first)return first;
 }
 return Job.findByIdAndUpdate(id,{$set:safe},{returnDocument:'after',runValidators:true});
}
module.exports={updateJob};
