const crypto=require('crypto');
const normalize=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
const endpointHash=s=>crypto.createHash('sha256').update(s).digest('hex');
function validSubscription(s){
 try{if(typeof s.endpoint!=='string'||s.endpoint.length>2048)return false;const u=new URL(s.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
 // Exact provider hosts only, never user-supplied generic fetch targets.
 if(!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns2-par02p.notify.windows.com'].includes(u.hostname))return false;
 if(!u.pathname||u.pathname==='/')return false;
 return /^[A-Za-z0-9_-]{80,100}$/.test(s.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{20,30}$/.test(s.keys?.auth||'');
 }catch{return false}
}
function createAlertService({models=require('./models/tutor-alert'),Account=require('./models/tutor-account').Account,Tutor=require('./models/tutor-profile'),Job=require('./models/jobmodel'),send,now=()=>new Date()}={}){
 const {Subscription,Delivery}=models;
 async function eligible(accountId,job){const a=await Account.findById(accountId);const t=a?.tutorId?await Tutor.findById(a.tutorId):null;return !!(t&&['approved','pending'].includes(t.status)&&normalize(t.city)&&normalize(t.preferredArea)&&normalize(t.city)===normalize(job.city)&&normalize(t.preferredArea)===normalize(job.location));}
 async function subscribe(accountId,value){if(!validSubscription(value))throw Error('Unsupported push subscription');const a=await Account.findById(accountId);const t=a?.tutorId?await Tutor.findById(a.tutorId):null;if(!t||!['approved','pending'].includes(t.status))throw Error('Tutor profile required');const hash=endpointHash(value.endpoint);const old=await Subscription.findOne({endpointHash:hash});if(old&&String(old.accountId)!==String(accountId))throw Error('Device subscription belongs to another account; disable it there first');if(!old?.active&&await Subscription.countDocuments({accountId,active:true})>=10)throw Error('Device limit reached');let values={accountId,endpoint:value.endpoint,keys:value.keys,active:true};if(!old?.active)values.enabledAt=now();return Subscription.findOneAndUpdate({endpointHash:hash},{$set:values},{upsert:true,returnDocument:'after',runValidators:true});}
 async function disable(accountId,hash){await Subscription.updateOne({accountId,endpointHash:hash},{$set:{active:false}});}
 async function enqueue(jobId,approvedAt=now()){
  const job=await Job.findById(jobId);if(!job||job.status!=='approved')return 0;
  const subs=await Subscription.find({active:true,enabledAt:{$lte:approvedAt}}).limit(5000);let queued=0;
  for(const sub of subs){if(!await eligible(sub.accountId,job))continue;const r=await Delivery.updateOne({subscriptionId:sub._id,jobId:job._id},{$setOnInsert:{accountId:sub.accountId,optInAt:sub.enabledAt,status:'pending',nextAttemptAt:now()}},{upsert:true});queued+=r.upsertedCount||0;}return queued;
 }
 async function drain({limit=20,realDelivery=false}={}){
  if(!send)throw Error('Delivery transport not configured');
  // Explicit call gate in addition to feature flag; fixture transport is the default.
  if(realDelivery&&process.env.TUTOR_ALERTS_LIVE!=='true')throw Error('Live alerts disabled');
  let handled=0;for(let i=0;i<Math.min(limit,50);i++){
   const when=now(),leaseToken=crypto.randomBytes(16).toString('hex');const d=await Delivery.findOneAndUpdate({$or:[{status:'pending',nextAttemptAt:{$lte:when}},{status:'sending',leaseUntil:{$lte:when}}]},{$set:{status:'sending',leaseToken,leaseUntil:new Date(+when+120000)},$inc:{attempts:1}},{sort:{nextAttemptAt:1},returnDocument:'after'});if(!d)break;
   const s=await Subscription.findById(d.subscriptionId).select('+endpoint +keys.p256dh +keys.auth');const job=await Job.findById(d.jobId);
   const finish=async status=>Delivery.updateOne({_id:d._id,status:'sending',leaseToken},{$set:{status,finishedAt:now()},$unset:{leaseUntil:1,leaseToken:1}});
   if(!s?.active||(d.optInAt&&+s.enabledAt>+d.optInAt)||!validSubscription({endpoint:s.endpoint,keys:s.keys})||!job||job.status!=='approved'||!await eligible(d.accountId,job)){await finish('skipped');handled++;continue;}
   const payload={title:'Tutor49',body:'New lead in your area. Open your tutor dashboard.',url:'/tutor',tag:'t49-lead-'+job._id};
   try{await send({endpoint:s.endpoint,keys:s.keys},payload);await finish('sent');}
   catch(e){if([404,410].includes(e.statusCode)){await Subscription.updateOne({_id:s._id},{$set:{active:false}});await finish('expired');}
   else if(d.attempts>=8||+when-+d.createdAt>86400000){await finish('expired');}
   else await Delivery.updateOne({_id:d._id,status:'sending',leaseToken},{$set:{status:'pending',nextAttemptAt:new Date(+when+Math.min(3600000,60000*2**d.attempts))},$unset:{leaseUntil:1,leaseToken:1}});}
   handled++;
  }return handled;
 }
 async function scanApproved(){const jobs=await Job.find({status:'approved',alertFirstApprovedAt:{$exists:true},alertEnqueuedAt:{$exists:false}}).select('+alertFirstApprovedAt').limit(20);for(const j of jobs){await enqueue(j._id,j.alertFirstApprovedAt);await Job.updateOne({_id:j._id,status:'approved'},{$set:{alertEnqueuedAt:now()}})}return jobs.length;}
 return {subscribe,disable,enqueue,drain,eligible,scanApproved};
}
module.exports={createAlertService,normalize,validSubscription,endpointHash};
