const express=require('express');const crypto=require('crypto');
function createAlertDrainRouter({service,token=process.env.TUTOR_ALERT_DRAIN_TOKEN,live=process.env.TUTOR_ALERTS_LIVE==='true'}={}){
 const r=express.Router();r.post('/',async(req,res)=>{
  if(!live||!token||token.length<32||!service)return res.status(503).json({error:'Alerts drain is disabled'});
  const candidate=String(req.get('Authorization')||'').replace(/^Bearer /,'');
  const digest=s=>crypto.createHash('sha256').update(s).digest();
  if(!crypto.timingSafeEqual(digest(candidate),digest(token)))return res.status(401).end();
  try{const scanned=await service.scanApproved();const handled=await service.drain({limit:20,realDelivery:true});res.json({scanned,handled});}catch{return res.status(503).json({error:'Alerts processing incomplete; retry later'})}
 });return r;
}
function configuredAlertService(){
 if(process.env.TUTOR_ALERTS_ENABLED!=='true'||process.env.TUTOR_ALERTS_LIVE!=='true')return null;
 const {TUTOR_PUSH_PUBLIC_KEY:publicKey,TUTOR_PUSH_PRIVATE_KEY:privateKey}=process.env;
 if(!publicKey||!privateKey)return null;
 const webpush=require('web-push');
 return require('./tutor-alert-service').createAlertService({send:async(subscription,payload)=>webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:{subject:'mailto:tutor49.official@gmail.com',publicKey,privateKey},TTL:3600,timeout:10000,urgency:'normal'})});
}
module.exports={createAlertDrainRouter,configuredAlertService};
