const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const mongoose=require('mongoose');const {MongoMemoryServer}=require('mongodb-memory-server');
const models=require('../models/tutor-alert');const {Account}=require('../models/tutor-account');const Tutor=require('../models/tutor'),Job=require('../models/jobmodel');const {createAlertService,validSubscription}=require('../tutor-alert-service');
let db,account,tutor,job,clock=new Date(),sent=[];let failure;
const subValue={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-test-device',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};
const service=createAlertService({now:()=>new Date(clock),send:async(s,p)=>{if(failure)throw failure;sent.push({s,p})}});
before(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('tutor49_alert_test'));await Promise.all(Object.values(models).map(m=>m.init()));tutor=await Tutor.create({name:'Test',phone:'7777777777',email:'alert@example.invalid',collegeId:'Test',city:' Lucknow ',preferredArea:'Aliganj',status:'pending',isPaid:true});account=await Account.create({googleSub:'alert-test',email:'alert@example.invalid',tutorId:tutor._id});job=await Job.create({parentName:'PRIVATE',contactNumber:'9999999999',city:'lucknow',location:' aliganj ',subject:'Math',grade:'8',salary:5000,status:'approved'});});
after(async()=>{await mongoose.disconnect();await db.stop()});
test('only known HTTPS push providers accepted; arbitrary private/loopback/credential endpoints rejected',()=>{assert.equal(validSubscription(subValue),true);for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://evil.example/x','https://fcm.googleapis.com.evil.example/x','https://u:p@fcm.googleapis.com/x'])assert.equal(validSubscription({...subValue,endpoint}),false)});
test('subscription is opt-in, private by default and bound to account; no historic replay',async()=>{assert.equal(await service.enqueue(job._id),0);const s=await service.subscribe(account._id,subValue);assert.equal(s.active,true);const safe=await models.Subscription.findById(s._id);assert.equal(safe.endpoint,undefined);assert.equal(safe.keys?.auth,undefined);const other=await Account.create({googleSub:'alert-other',email:'other@example.invalid'});await assert.rejects(()=>service.subscribe(other._id,subValue));assert.equal(await service.enqueue(job._id,new Date(+clock-1)),0)});
test('matching normalized area/city queues once and pending tutor alert is masked without private fields',async()=>{assert.equal(await service.enqueue(job._id,clock),1);assert.equal(await service.enqueue(job._id,clock),0);assert.equal(await service.drain(),1);assert.equal(sent.length,1);const payload=JSON.stringify(sent[0].p);assert.ok(!payload.includes('PRIVATE'));assert.ok(!payload.includes('9999999999'));assert.equal(sent[0].p.url,'/tutor');assert.equal(await service.drain(),0)});
test('withdrawn leads and disabled devices are skipped at send time',async()=>{const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'Science',grade:'10',salary:5000,status:'approved'});await service.enqueue(j._id,clock);await Job.updateOne({_id:j._id},{$set:{status:'hidden'}});await service.drain();assert.equal(sent.length,1);const d=await models.Delivery.findOne({jobId:j._id});assert.equal(d.status,'skipped')});
test('mismatched areas and rejected profiles never queue',async()=>{const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Gomti Nagar',subject:'English',grade:'6',salary:5000,status:'approved'});assert.equal(await service.enqueue(j._id,clock),0);await Tutor.updateOne({_id:tutor._id},{$set:{status:'rejected'}});assert.equal(await service.enqueue(job._id,clock),0);await Tutor.updateOne({_id:tutor._id},{$set:{status:'pending'}})});
test('transient errors persist bounded retries; gone endpoint deactivates subscription',async()=>{const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'Hindi',grade:'7',salary:5000,status:'approved'});await service.enqueue(j._id,clock);failure={statusCode:503};await service.drain();let d=await models.Delivery.findOne({jobId:j._id});assert.equal(d.status,'pending');assert.ok(d.nextAttemptAt>clock);assert.equal(await service.drain(),0);clock=new Date(+clock+3600000);failure={statusCode:410};await service.drain();d=await models.Delivery.findOne({jobId:j._id});assert.equal(d.status,'expired');assert.equal((await models.Subscription.findOne()).active,false);failure=null;assert.equal(sent.length,1)});
test('approval scan only handles newly marked approvals, survives repeat scan, and ignores old records',async()=>{
 const sub=await service.subscribe(account._id,subValue);const old=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'Old',grade:'8',salary:5000,status:'approved'});
 const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'New marker',grade:'8',salary:5000,status:'approved',alertFirstApprovedAt:clock});
 assert.equal(await service.scanApproved(),1);assert.equal(await service.scanApproved(),0);assert.equal(await models.Delivery.countDocuments({jobId:old._id}),0);assert.equal(await models.Delivery.countDocuments({jobId:j._id}),1);
 await service.disable(account._id,sub.endpointHash);await service.drain();assert.equal((await models.Delivery.findOne({jobId:j._id})).status,'skipped');
});
test('internal drain is disabled by default and requires exact authorization when enabled',async()=>{
 const express=require('express');const {createAlertDrainRouter}=require('../tutor-alert-drain');let calls=0;const app=express();const token='synthetic-test-only-token-32-characters';const mock={scanApproved:async()=>{calls++;return 1},drain:async()=>2};app.use('/off',createAlertDrainRouter({service:mock,token,live:false}));app.use('/on',createAlertDrainRouter({service:mock,token,live:true}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root='http://127.0.0.1:'+server.address().port;try{assert.equal((await fetch(root+'/off',{method:'POST'})).status,503);assert.equal((await fetch(root+'/on',{method:'POST'})).status,401);assert.equal(calls,0);const r=await fetch(root+'/on',{method:'POST',headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{scanned:1,handled:2});assert.equal(calls,1)}finally{await new Promise(r=>server.close(r))}
});
test('repeated active opt-in does not invalidate queued consent generation',async()=>{
 const a=await service.subscribe(account._id,subValue),before=+a.enabledAt;
 clock=new Date(+clock+1000);const b=await service.subscribe(account._id,subValue);
 assert.equal(+b.enabledAt,before);
 await service.disable(account._id,b.endpointHash);clock=new Date(+clock+1000);
 const c=await service.subscribe(account._id,subValue);assert.ok(+c.enabledAt>before);
});
test('expired worker cannot overwrite a newer lease completion',async()=>{
 await models.Delivery.deleteMany({});
 let release;const gate=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
 const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'Lease race',grade:'8',salary:5000,status:'approved'});
 await service.enqueue(j._id,clock);
 const slow=createAlertService({now:()=>new Date(clock),send:async()=>{entered();await gate;throw {statusCode:503}}});
 const first=slow.drain({limit:1});await started;clock=new Date(+clock+120001);
 await service.drain({limit:1});assert.equal((await models.Delivery.findOne({jobId:j._id})).status,'sent');
 release();await first;assert.equal((await models.Delivery.findOne({jobId:j._id})).status,'sent');
});
test('first approval stamps once with no second unconditional write',async()=>{
 const {updateJob}=require('../job-update');let calls=0;
 const found={_id:'fixture',status:'approved'};
 const fake={findOneAndUpdate:async(filter,change)=>{calls++;assert.equal(filter.alertFirstApprovedAt.$exists,false);assert.ok(change.$set.alertFirstApprovedAt);return found},findByIdAndUpdate:async()=>assert.fail('double write')};
 assert.equal(await updateJob(fake,'fixture',{status:'approved',alertEnqueuedAt:new Date()},{alertsEnabled:true}),found);assert.equal(calls,1);
 const j=await Job.create({parentName:'Synthetic',contactNumber:'0000000000',city:'Lucknow',location:'Aliganj',subject:'Approval',grade:'8',salary:5000,status:'pending'});
 await updateJob(Job,j._id,{status:'approved'},{alertsEnabled:true,now:()=>clock});
 const original=+(await Job.findById(j._id).select('+alertFirstApprovedAt')).alertFirstApprovedAt;
 await updateJob(Job,j._id,{status:'hidden'},{alertsEnabled:true});
 await updateJob(Job,j._id,{status:'approved'},{alertsEnabled:true,now:()=>new Date(+clock+1000)});
 assert.equal(+(await Job.findById(j._id).select('+alertFirstApprovedAt')).alertFirstApprovedAt,original);
});
