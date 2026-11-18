const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const crypto=require('crypto');
const {createTutorAccountRouter}=require('../tutor-account-routes');
const {createTutorAccountAdminRouter}=require('../tutor-account-admin');
const Unlock=require('../models/UnlockRequest');
const models=require('../models/tutor-account');
const Tutor=require('../models/tutor-profile');const LegacyTutor=require('../models/tutor');const Job=require('../models/jobmodel');
const origin='http://localhost:5173',secret='test-only-payment-secret';
let db,server,base,orders=new Map(),payments=new Map(),serial=0;
const rp={orders:{async create(o){const order={...o,id:'order_'+(++serial)};orders.set(order.id,order);return order},async fetch(id){return orders.get(id)},async fetchPayments(id){return {items:[...payments.values()].filter(p=>p.order_id===id)}}},payments:{async fetch(id){return payments.get(id)}}};
before(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('tutor49_test'));await Promise.all(Object.values(models).map(m=>m.init()));await Tutor.init();await LegacyTutor.init();
 const app=express();app.use('/webhook',require('../tutor-account-payments').createPaymentWebhook({models,Tutor,razorpay:rp,secret:'local-webhook-secret'}));app.use(express.json());app.use('/api/tutor-account',createTutorAccountRouter({models,Tutor,Job,razorpay:rp,config:{loginLimit:200,enabled:true,googleClientId:'test-client',origins:[origin],secure:false,paymentSecret:secret,paymentKey:'rzp_test_local',pendingPolicy:'status-only',retentionPolicy:'retain-purchased'},verifyGoogle:async s=>{if(s==='bad')throw Error('invalid');return JSON.parse(s)}}));
 app.use('/masked',createTutorAccountRouter({models,Tutor,Job,razorpay:rp,config:{enabled:true,googleClientId:'test-client',origins:[origin],secure:false,paymentSecret:secret,paymentKey:'rzp_test_local',pendingPolicy:'masked'}}));
 app.use('/invite',createTutorAccountRouter({models,Tutor,Job,config:{enabled:true,googleClientId:'test-client',origins:[origin],secure:false,previewEmails:['chosen-test@gmail.com']},verifyGoogle:async value=>JSON.parse(value)}));
 app.use('/api/admin/tutor-accounts',(req,res,next)=>req.get('Authorization')==='Bearer local-test-admin'?next():res.status(401).json({error:'Admin required'}),createTutorAccountAdminRouter({models,Tutor:LegacyTutor,Unlock}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/tutor-account`;});
after(async()=>{await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop()});
async function req(path,{method='GET',body,cookie='',csrf='',requestOrigin=origin}={}){return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{}),Cookie:cookie,'X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
async function login(sub,email=sub+'@gmail.com'){
 const b=await req('/bootstrap'),p=await b.json();const res=await req('/google',{method:'POST',cookie:cookies(b),body:{credential:JSON.stringify({sub,email,name:'Test tutor',email_verified:true,nonce:p.nonce})}});
 assert.equal(res.status,200);const data=await res.json();return {cookie:cookies(res),csrf:data.csrfToken,data,sub};}
async function profile(s,phone){let r=await req('/profile',{...s,method:'POST',body:{name:'Test tutor',phone,collegeId:'test-id',city:'Test city',preferredArea:'Test area',isPaid:true,status:'approved',email:'wrong@gmail.com'}});assert.equal(r.status,201);return models.Account.findOne({googleSub:s.sub});}
async function captured(s,o,override={}){const pid='pay_'+(++serial);payments.set(pid,{id:pid,order_id:o.orderId,status:'captured',amount:4900,currency:'INR',...override});return req('/orders/verify',{...s,method:'POST',body:{orderId:o.orderId,paymentId:pid,signature:crypto.createHmac('sha256',secret).update(o.orderId+'|'+pid).digest('hex')}});}
let alice,bob,aa,ba,job,purchase;
test('origin allowlist, login bootstrap and missing session fail closed',async()=>{
 assert.equal((await req('/session')).status,401);assert.equal((await req('/bootstrap',{requestOrigin:'https://attacker.example'})).status,403);
 assert.equal((await req('/google',{method:'POST',requestOrigin:'',body:{credential:'bad'}})).status,403);
 const b=await req('/bootstrap');assert.match(b.headers.get('set-cookie'),/HttpOnly/i);assert.match(b.headers.get('set-cookie'),/SameSite=Lax/i);
 const bad=await req('/google',{method:'POST',cookie:cookies(b),body:{credential:'bad'}});assert.equal(bad.status,401);
});
test('nonce mismatch and replay are rejected',async()=>{const b=await req('/bootstrap');const c=cookies(b);let r=await req('/google',{method:'POST',cookie:c,body:{credential:JSON.stringify({sub:'badnonce',email:'badnonce@gmail.com',email_verified:true,nonce:'wrong'})}});assert.equal(r.status,401);r=await req('/google',{method:'POST',cookie:c,body:{credential:'bad'}});assert.equal(r.status,401);});
test('Google-only login creates durable account with private revocable session, not tutor approval',async()=>{alice=await login('alice');aa=await models.Account.findOne({googleSub:'alice'});assert.equal(aa.tutorId,null);assert.equal(await Tutor.countDocuments(),0);const ss=await models.Session.findOne({accountId:aa._id});assert.equal(ss.tokenHash.length,64);assert.ok(!ss.tokenHash.includes(alice.cookie));assert.equal((await req('/session',alice)).status,200);});
test('profile allowlists fields, preserves Google identity, and refuses CSRF',async()=>{assert.equal((await req('/profile',{cookie:alice.cookie,method:'POST',body:{}})).status,403);aa=await profile(alice,'1111111111');const t=await Tutor.findById(aa.tutorId);assert.equal(t.email,'alice@gmail.com');assert.equal(t.isPaid,false);assert.equal(t.status,'pending');assert.equal((await req('/profile',{...alice,method:'POST',body:{}})).status,409);});
test('pending tutor cannot see board or buy lead',async()=>{assert.equal((await req('/leads',alice)).status,403);assert.equal((await req('/orders',{...alice,method:'POST',body:{kind:'lead',jobId:'000000000000000000000001'}})).status,403);});
test('old /register records never block a fresh Google account, and old records stay untouched',async()=>{const old=await LegacyTutor.create({name:'Old tutor',email:'fresh@gmail.com',phone:'2222222222',collegeId:'secret-test-id',city:'Test',preferredArea:'Test',status:'approved',isPaid:true});const s=await login('fresh');assert.equal(s.data.account.legacyReview,false);assert.equal(s.data.profile,null);const f=await profile(s,'6666666666');const p=await Tutor.findById(f.tutorId);assert.equal(p.email,'fresh@gmail.com');assert.equal(p.isPaid,false);assert.equal(p.status,'pending');assert.notEqual(String(p._id),String(old._id));const o=await LegacyTutor.findById(old._id);assert.equal(o.phone,'2222222222');assert.equal(o.isPaid,true);assert.equal(await LegacyTutor.countDocuments(),1);
 await models.Account.create({googleSub:'legacy',email:'legacy@gmail.com',legacyReview:true});await LegacyTutor.create({name:'Old tutor 2',email:'legacy@gmail.com',phone:'5555555555',collegeId:'secret-test-id',city:'Test',preferredArea:'Test',status:'approved',isPaid:true});});
test('registration order is account-bound and reused before payment, wrong amount rejected',async()=>{const r=await req('/orders',{...alice,method:'POST',body:{kind:'registration',amount:1}});assert.equal(r.status,200);const o=await r.json();assert.equal(o.amount,4900);const again=await(await req('/orders',{...alice,method:'POST',body:{kind:'registration'}})).json();assert.equal(again.orderId,o.orderId);assert.equal((await captured(alice,o,{amount:1})).status,500);assert.equal((await Tutor.findById(aa.tutorId)).isPaid,false);assert.equal((await captured(alice,o)).status,200);const t=await Tutor.findById(aa.tutorId);assert.equal(t.isPaid,true);assert.equal(t.status,'pending');assert.equal((await req('/orders',{...alice,method:'POST',body:{kind:'registration'}})).status,409);});
test('available leads are approved-only and never contain private contacts or parent identity',async()=>{await Tutor.updateOne({_id:aa.tutorId},{$set:{status:'approved'}});job=await Job.create({parentName:'Private test name',contactNumber:'9876543210',subject:'Math',grade:'8',city:'Test',location:'Test',salary:5000,status:'approved',leadType:'direct'});await Job.create({parentName:'Hidden test',contactNumber:'9876543211',subject:'Secret',grade:'9',city:'Test',location:'Test',salary:6000,status:'hidden'});const r=await req('/leads',alice);assert.equal(r.status,200);const j=await r.json();assert.equal(j.total,1);assert.equal(j.jobs[0].contactNumber,undefined);assert.equal(j.jobs[0].parentName,undefined);});
test('another account cannot verify or view someone else order/history/contact',async()=>{bob=await login('bob');ba=await profile(bob,'3333333333');await Tutor.updateOne({_id:ba.tutorId},{$set:{status:'approved',isPaid:true}});const o=await(await req('/orders',{...alice,method:'POST',body:{kind:'lead',jobId:String(job._id)}})).json();assert.equal((await captured(bob,o)).status,404);assert.equal((await captured(alice,o)).status,200);purchase=await models.Order.findOne({providerOrderId:o.orderId});const history=await(await req('/history',bob)).json();assert.equal(history.items.length,0);assert.equal((await req('/history/'+purchase._id+'/contact',bob)).status,404);assert.equal((await req('/history/'+purchase._id+'/contact',alice)).status,200);assert.equal((await req('/orders',{...alice,method:'POST',body:{kind:'lead',jobId:String(job._id)}})).status,409);});
test('interim retention shows hidden purchased contacts only to their verified purchaser; privacy suppression and deletion win',async()=>{await Job.updateOne({_id:job._id},{$set:{status:'hidden'}});let h=await(await req('/history',alice)).json();assert.equal(h.items.length,1);assert.equal(h.items[0].contactAvailable,true);assert.equal(h.items[0].job.contactNumber,undefined);assert.equal((await req('/history/'+purchase._id+'/contact',alice)).status,200);assert.equal((await req('/history/'+purchase._id+'/contact',bob)).status,404);const closed=await fetch(base.replace('/api/tutor-account','/masked')+'/history/'+purchase._id+'/contact',{headers:{Cookie:alice.cookie,Origin:origin}});assert.equal(closed.status,409);await Job.updateOne({_id:job._id},{$set:{status:'rejected'}});assert.equal((await req('/history/'+purchase._id+'/contact',alice)).status,200);await Job.updateOne({_id:job._id},{$set:{contactSuppressedAt:new Date()}});h=await(await req('/history',alice)).json();assert.equal(h.items[0].contactAvailable,false);assert.equal(h.items[0].job,null);assert.equal((await req('/history/'+purchase._id+'/contact',alice)).status,409);assert.equal((await req('/orders',{...bob,method:'POST',body:{kind:'lead',jobId:String(job._id)}})).status,404);await Job.deleteOne({_id:job._id});h=await(await req('/history',alice)).json();assert.equal(h.items[0].job,null);assert.equal(h.items[0].availability,'deleted');});
test('logout revokes server-side session and expired sessions are rejected even before TTL cleanup',async()=>{assert.equal((await req('/logout',{...bob,method:'POST',body:{}})).status,204);assert.equal((await req('/session',bob)).status,401);await models.Session.updateMany({accountId:aa._id},{$set:{expiresAt:new Date(0)}});assert.equal((await req('/session',alice)).status,401);});

async function admin(path,body,authorized=true){return fetch(base.replace('/api/tutor-account','')+'/api/admin/tutor-accounts'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer local-test-admin'}:{})},...(body?{body:JSON.stringify(body)}:{})})}
test('legacy recovery is admin-only and requires explicit evidence; links preserve paid/approval and revoke old session',async()=>{
 assert.equal((await admin('/',undefined,false)).status,401);
 const a=await models.Account.findOne({googleSub:'legacy'}),t=await LegacyTutor.findOne({email:'legacy@gmail.com'});
 const data={accountId:String(a._id),tutorId:String(t._id),reference:'support-evidence-case-001',ownershipVerified:false};
 assert.equal((await admin('/link-registration',data)).status,400);data.ownershipVerified=true;
 assert.equal((await admin('/link-registration',data)).status,200);
 const linked=await models.Account.findById(a._id),unchanged=await LegacyTutor.findById(t._id);
 assert.equal(String(linked.tutorId),String(t._id));assert.equal(linked.legacyReview,false);assert.equal(unchanged.isPaid,true);assert.equal(unchanged.status,'approved');
 assert.equal(await models.Session.countDocuments({accountId:a._id}),0);
 assert.equal((await admin('/link-registration',data)).status,409);
});
test('reviewed legacy recovery does not rewrite originals, duplicate or invent deleted contacts',async()=>{
 const a=await models.Account.findOne({googleSub:'legacy'});
 const u=await Unlock.create({jobId:new mongoose.Types.ObjectId(),tutorPhone:'2222222222',transactionId:'old-evidence-reference',status:'Approved'});const original=JSON.stringify(u.toObject());
 const proof={accountId:String(a._id),unlockId:String(u._id),ownershipVerified:true,paymentVerified:false,reference:'support-payment-proof-001'};
 assert.equal((await admin('/recover-purchase',proof)).status,400);proof.paymentVerified=true;
 assert.equal((await admin('/recover-purchase',proof)).status,201);assert.equal((await admin('/recover-purchase',proof)).status,409);
 assert.deepEqual(JSON.parse(JSON.stringify((await Unlock.findById(u._id)).toObject())),JSON.parse(original));
 const s=await login('legacy');const h=await(await req('/history',s)).json();assert.equal(h.items.length,1);assert.equal(h.items[0].job,null);assert.equal(h.items[0].verificationType,'admin-reviewed-recovery');
});

const {createPaymentService}=require('../tutor-account-payments');
async function abandoned(kind='lead'){
 const a=await models.Account.findOne({googleSub:'bob'}),resource=String(new mongoose.Types.ObjectId());
 const o=await models.Order.create({accountId:a._id,tutorId:a.tutorId,kind,resource,jobId:kind==='lead'?resource:undefined,status:'created',providerOrderId:'order_abandoned'+(++serial)});
 orders.set(o.providerOrderId,{id:o.providerOrderId,amount:4900,currency:'INR',notes:{purpose:`tutor49_${kind}_v1`,accountId:String(a._id),tutorId:String(a.tutorId),resource}});
 const p={id:'pay_abandoned'+(++serial),order_id:o.providerOrderId,amount:4900,currency:'INR',status:'captured'};payments.set(p.id,p);return {o,p,a};
}
async function webhook(body,signature){return fetch(base.replace('/api/tutor-account','')+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Razorpay-Signature':signature},body})}
const signWebhook=body=>crypto.createHmac('sha256','local-webhook-secret').update(body).digest('hex');
test('closed-tab provider reconciliation restores entitlement without browser proof and is idempotent',async()=>{
 const {o,p}=await abandoned();const service=createPaymentService({models,Tutor,razorpay:rp});
 assert.equal((await service.reconcile(o)).verified,true);assert.equal((await service.reconcile(o)).verified,true);
 assert.equal((await models.Order.findById(o._id)).paymentId,p.id);assert.equal(await models.Order.countDocuments({_id:o._id}),1);
});
test('signed capture webhook works without user session, rejects forgery and altered bytes, safely repeats',async()=>{
 const {o,p}=await abandoned();const body=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:p.id,order_id:o.providerOrderId}}}});
 assert.equal((await webhook(body,'bad')).status,401);assert.equal((await webhook(body+' ',signWebhook(body))).status,401);
 assert.equal((await models.Order.findById(o._id)).status,'created');
 assert.equal((await webhook(body,signWebhook(body))).status,204);assert.equal((await webhook(body,signWebhook(body))).status,204);
 assert.equal((await models.Order.findById(o._id)).status,'verified');
});
test('provider mismatch or delayed capture does not grant access, later captured status repairs registration',async()=>{
 const {o,p,a}=await abandoned('registration');await Tutor.updateOne({_id:a.tutorId},{$set:{isPaid:false}});
 const service=createPaymentService({models,Tutor,razorpay:rp});p.status='authorized';assert.equal((await service.reconcile(o)).pending,true);assert.equal((await models.Order.findById(o._id)).status,'created');
 p.status='captured';p.amount=1;await assert.rejects(()=>service.reconcile(o));assert.equal((await Tutor.findById(a.tutorId)).isPaid,false);
 p.amount=4900;assert.equal((await service.reconcile(o)).verified,true);assert.equal((await Tutor.findById(a.tutorId)).isPaid,true);
 await Tutor.updateOne({_id:a.tutorId},{$set:{isPaid:false}});assert.equal(await service.settle(await models.Order.findById(o._id),p.id),true);assert.equal((await Tutor.findById(a.tutorId)).isPaid,true);
});
test('unknown/failed payments cannot create entitlements and conflicting captures require review',async()=>{
 const {o,p}=await abandoned();const service=createPaymentService({models,Tutor,razorpay:rp});p.status='failed';assert.equal((await service.reconcile(o)).verified,false);
 p.status='captured';payments.set('pay_conflict',{...p,id:'pay_conflict'});await assert.rejects(()=>service.reconcile(o));assert.equal((await models.Order.findById(o._id)).status,'created');
});

test('webhook recovers interrupted provider-order save by exact receipt and immutable binding',async()=>{
 const {o,p}=await abandoned();const order=orders.get(o.providerOrderId);order.receipt='t49_'+o._id;
 await models.Order.updateOne({_id:o._id},{$unset:{providerOrderId:1},$set:{status:'creating'}});
 const body=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:p.id,order_id:o.providerOrderId}}}});
 assert.equal((await webhook(body,signWebhook(body))).status,204);const saved=await models.Order.findById(o._id);assert.equal(saved.status,'verified');assert.equal(saved.providerOrderId,o.providerOrderId);
});
test('reconciliation API requires own session and CSRF and never settles another account order',async()=>{
 const {o}=await abandoned();assert.equal((await req('/orders/reconcile',{method:'POST',body:{}})).status,401);
 const aliceAgain=await login('alice');assert.equal((await req('/orders/reconcile',{cookie:aliceAgain.cookie,method:'POST',body:{}})).status,403);
 const before=(await models.Order.findById(o._id)).status;
 assert.equal((await req('/orders/reconcile',{...aliceAgain,method:'POST',body:{}})).status,200);assert.equal((await models.Order.findById(o._id)).status,before);
 const bobAgain=await login('bob');assert.equal((await req('/orders/reconcile',{...bobAgain,method:'POST',body:{}})).status,200);assert.equal((await models.Order.findById(o._id)).status,'verified');
});

test('approved masked policy lets pending tutors browse contact-free board but not purchase; no-profile accounts browse the same masked board but cannot purchase; rejected remains blocked',async()=>{
 const s=await login('maskedpending');const a=await profile(s,'4444444444');await Job.create({subject:'Masked policy test',grade:'8',contactNumber:'9999999999',parentName:'Private policy test',location:'Test',city:'Test',salary:5000,status:'approved'});
 const maskedBase=base.replace('/api/tutor-account','')+'/masked';
 const headers={Origin:origin,Cookie:s.cookie,'Content-Type':'application/json','X-CSRF-Token':s.csrf};
 let r=await fetch(maskedBase+'/leads',{headers});assert.equal(r.status,200);const list=await r.json();assert.ok(list.jobs.length);assert.ok(list.jobs.every(j=>!('contactNumber' in j)&&!('parentName' in j)));
 r=await fetch(maskedBase+'/orders',{method:'POST',headers,body:JSON.stringify({kind:'lead',jobId:list.jobs[0]._id})});assert.equal(r.status,403);
 await Tutor.updateOne({_id:a.tutorId},{$set:{status:'rejected'}});assert.equal((await fetch(maskedBase+'/leads',{headers})).status,403);
 await models.Account.updateOne({_id:a._id},{$set:{tutorId:null}});r=await fetch(maskedBase+'/leads',{headers});assert.equal(r.status,200);const fresh=await r.json();assert.ok(fresh.jobs.length&&fresh.jobs.every(j=>!('contactNumber' in j)&&!('parentName' in j)));r=await fetch(maskedBase+'/orders',{method:'POST',headers,body:JSON.stringify({kind:'lead',jobId:fresh.jobs[0]._id})});assert.equal(r.status,403);
});

test('explicit preview invite gate blocks unchosen verified Google identity before creating an account',async()=>{
 const root=base.replace('/api/tutor-account','')+'/invite';
 for(const email of ['unchosen-test@gmail.com','chosen-test@gmail.com']){const b=await fetch(root+'/bootstrap',{headers:{Origin:origin}});const challenge=await b.json();const response=await fetch(root+'/google',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies(b)},body:JSON.stringify({credential:JSON.stringify({sub:email,email,email_verified:true,nonce:challenge.nonce})})});assert.equal(response.status,email.startsWith('unchosen')?403:200)}
 assert.equal(await models.Account.countDocuments({googleSub:'unchosen-test@gmail.com'}),0);assert.equal(await models.Account.countDocuments({googleSub:'chosen-test@gmail.com'}),1);
});

test('server-side admin email opens leads and contacts without payment; non-admins and fake paid flags do not',async()=>{
 const adm=await login('adminsub','amaank7007@gmail.com');assert.equal(adm.data.account.isAdmin,true);assert.equal(adm.data.profile,null);
 const jb=await Job.create({parentName:'Admin test',contactNumber:'9123456780',subject:'Sci',grade:'7',city:'Test',location:'Test',salary:4000,status:'approved',leadType:'direct'});
 const list=await(await req('/leads',adm)).json();assert.ok(list.jobs.some(j=>String(j._id)===String(jb._id)));assert.equal(list.jobs[0].contactNumber,undefined);
 const o=await req('/orders',{...adm,method:'POST',body:{kind:'lead',jobId:String(jb._id),isAdmin:true}});assert.equal(o.status,200);assert.equal((await o.json()).adminAccess,true);assert.equal(await req('/orders',{...adm,method:'POST',body:{kind:'registration'}}).then(r=>r.status),400);
 const h=await(await req('/history',adm)).json();assert.equal(h.items.length,1);assert.equal(h.items[0].verificationType,'admin-access');
 const c=await(await req('/history/'+h.items[0].purchaseId+'/contact',adm)).json();assert.equal(c.contactNumber,'9123456780');
 assert.equal(await models.Order.countDocuments({accountId:(await models.Account.findOne({googleSub:'adminsub'}))._id,paymentId:{$exists:true}}),0);
 const spoof=await login('spoofsub','amaank7007+x@gmail.com');assert.equal(spoof.data.account.isAdmin,false);assert.equal((await req('/leads',spoof)).status,403);assert.equal((await req('/orders',{...spoof,method:'POST',body:{kind:'lead',jobId:String(jb._id),isAdmin:true}})).status,403);
});

test('Google admin can mint the existing admin-console session only server-side; others cannot',async()=>{
 const adm=await login('adminsub2','amaank7007@gmail.com');const none=await req('/admin-console',{...adm,method:'POST',body:{}});assert.equal(none.status,403);
 const issued=[];const {createTutorAccountRouter:mk}=require('../tutor-account-routes');const app=express();app.use(express.json());
 app.use('/x',mk({models,Tutor,Job,razorpay:rp,config:{loginLimit:200,enabled:true,googleClientId:'test-client',origins:[origin],secure:false,paymentSecret:secret,pendingPolicy:'status-only',retentionPolicy:'retain-purchased',issueAdminSession:()=>{issued.push(1);return {token:'t',expiresAt:1}}},verifyGoogle:async v=>JSON.parse(v)}));
 const srv=await new Promise(r=>{const s=app.listen(0,()=>r(s))});const b='http://127.0.0.1:'+srv.address().port+'/x';
 const bs=await fetch(b+'/bootstrap');const pj=await bs.json();const ck=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const lg=async(sub,email)=>{const b0=await fetch(b+'/bootstrap');const p=await b0.json();const r=await fetch(b+'/google',{method:'POST',headers:{'Content-Type':'application/json',Cookie:ck(b0),Origin:origin},body:JSON.stringify({credential:JSON.stringify({sub,email,name:'T',email_verified:true,nonce:p.nonce})})});return {cookie:ck(r),csrf:(await r.json()).csrfToken}};
 const a1=await lg('adm3','amaank7007@gmail.com'),a2=await lg('usr3','someone@gmail.com');
 const call=s=>fetch(b+'/admin-console',{method:'POST',headers:{'Content-Type':'application/json',Cookie:s.cookie,Origin:origin,'X-CSRF-Token':s.csrf},body:'{}'});
 assert.equal((await call(a2)).status,403);assert.equal(issued.length,0);const ok=await call(a1);assert.equal(ok.status,200);assert.equal((await ok.json()).token,'t');assert.equal(issued.length,1);srv.close();
});
