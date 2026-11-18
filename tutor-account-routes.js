const express=require('express');
const crypto=require('crypto');
const rateLimit=require('express-rate-limit');
const mongoose=require('mongoose');
const {OAuth2Client}=require('google-auth-library');
const {validPaymentSignature}=require('./payment-verification');
const {createPaymentService}=require('./tutor-account-payments');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const id=v=>String(v?._id||v||'');
const cookieValue=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const maskJob=j=>({_id:id(j),displayId:j.displayId,subject:j.subject,grade:j.grade,city:j.city,location:j.location,salary:j.salary,requirements:j.requirements,leadType:j.leadType,price:49});
function createTutorAccountRouter({models=require('./models/tutor-account'),Tutor=require('./models/tutor-profile'),Job=require('./models/jobmodel'),razorpay,alertModels=require('./models/tutor-alert'),config={},verifyGoogle}={}){
 const {Account,Session,Challenge,Order}=models;const r=express.Router();
 const paymentService=createPaymentService({models,Tutor,razorpay});
 const enabled=config.enabled??process.env.TUTOR_ACCOUNTS_ENABLED==='true';
 const live=config.live??process.env.TUTOR_ACCOUNTS_LIVE==='true';
 const googleClientId=config.googleClientId||process.env.GOOGLE_CLIENT_ID;
 const origins=config.origins||String(process.env.TUTOR_ACCOUNT_ORIGINS||'').split(',').filter(Boolean);
 const secure=config.secure??true;const namespace=config.cookieNamespace||'t49';if(!['t49','t49test'].includes(namespace))throw Error('Invalid account cookie namespace');const sessionName=(secure?'__Host-':'')+namespace+'session';const preName=(secure?'__Host-':'')+namespace+'login';
 const cookieOpts={httpOnly:true,secure,sameSite:'lax',path:'/'};
 const pendingPolicy=config.pendingPolicy||process.env.TUTOR_PENDING_BOARD_POLICY;
 const retentionPolicy=config.retentionPolicy||process.env.TUTOR_PURCHASE_CONTACT_POLICY;
 const contactAvailable=j=>Boolean(j&&!j.contactSuppressedAt&&/^\d{10}$/.test(j.contactNumber||'')&&(j.status==='approved'||(retentionPolicy==='retain-purchased'&&['hidden','rejected'].includes(j.status))));
 // App-level admins: exact verified Google email, decided on the server only. Not a provider/hosting grant.
 const adminEmails=new Set([...(config.adminEmails||String(process.env.TUTOR_ADMIN_EMAILS||'').split(',')),'amaank7007@gmail.com'].map(v=>String(v).trim().toLowerCase()).filter(Boolean));
 const isAdmin=a=>Boolean(a?.email&&adminEmails.has(String(a.email).toLowerCase()));
 const paySecret=config.paymentSecret||process.env.RAZORPAY_KEY_SECRET;
 const client=new OAuth2Client(googleClientId);
 const verify=verifyGoogle|| (async credential=>(await client.verifyIdToken({idToken:credential,audience:googleClientId})).getPayload());
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(()=>res.status(500).json({error:'Request could not be completed. Please retry or contact support.'}));
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!enabled)return res.status(404).json({error:'Tutor accounts are not enabled.'});
  if(live&&(!['status-only','masked'].includes(pendingPolicy)||!['approved-only','retain-purchased'].includes(retentionPolicy)))return res.status(503).json({error:'Account launch is waiting for access-policy approval.'});
  const origin=req.get('Origin');if(origin&&!origins.includes(origin))return res.status(403).json({error:'Origin not allowed.'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!origin||!origins.includes(origin)))return res.status(403).json({error:'Trusted site origin required.'});next();});
 const loginLimit=rateLimit({windowMs:600000,limit:config.loginLimit||20,standardHeaders:true,legacyHeaders:false});
 const payLimit=rateLimit({windowMs:600000,limit:20,standardHeaders:true,legacyHeaders:false});
 async function auth(req,res,next){const token=cookieValue(req,sessionName);if(!/^[\w-]{43}$/.test(token))return res.status(401).json({error:'Please sign in.'});
 const session=await Session.findOne({tokenHash:hash(token),expiresAt:{$gt:new Date()}});if(!session)return res.status(401).json({error:'Please sign in again.'});
 const account=await Account.findById(session.accountId);if(!account)return res.status(401).json({error:'Please sign in again.'});
 if(account.legacyReview&&!account.tutorId&&!account.legacyLinkedAt){await Account.updateOne({_id:account._id,tutorId:null,legacyReview:true},{$set:{legacyReview:false}});account.legacyReview=false;}
 req.tutorSession=session;req.tutorAccount=account;
 if(!['GET','HEAD'].includes(req.method)&&req.get('X-CSRF-Token')!==session.csrfToken)return res.status(403).json({error:'Refresh the page and retry.'});next();}
 const requireSession=wrap(auth);
 const accountView=async a=>{const t=a.tutorId?await Tutor.findById(a.tutorId):null;return {account:{email:a.email,name:a.name,legacyReview:a.legacyReview,isAdmin:isAdmin(a)},profile:t?{name:t.name,phone:t.phone,city:t.city,preferredArea:t.preferredArea,status:t.status,isPaid:Boolean(t.isPaid)}:null,preview:!live,pendingBoardPolicy:pendingPolicy||'undecided'};};
 const requireBuyer=wrap(async(req,res,next)=>{const a=req.tutorAccount;const t=a.tutorId?await Tutor.findById(a.tutorId):null;if(!t||t.status!=='approved'||!t.isPaid)return res.status(403).json({error:'Paid registration and admin approval required.'});req.tutorProfile=t;next();});
 const payReady=(req,res,next)=>{if(!razorpay||!paySecret)return res.status(503).json({error:'Payments are not configured.'});
  if(!live&&!String(config.paymentKey||process.env.RAZORPAY_KEY_ID).startsWith('rzp_test_'))return res.status(503).json({error:'Preview cannot use live payment keys.'});next();};
 r.get('/bootstrap',loginLimit,wrap(async(req,res)=>{if(!googleClientId)return res.status(503).json({error:'Google sign-in setup is still pending. No imitation login is available.'});
 const token=random(),nonce=random();await Challenge.create({tokenHash:hash(token),nonce,expiresAt:new Date(Date.now()+600000)});
 res.cookie(preName,token,{...cookieOpts,maxAge:600000});res.json({googleClientId,nonce,preview:!live});}));
 r.post('/google',loginLimit,wrap(async(req,res)=>{if(!googleClientId)return res.status(503).json({error:'Google sign-in setup pending.'});
 const challengeToken=cookieValue(req,preName);const c=await Challenge.findOneAndDelete({tokenHash:hash(challengeToken),expiresAt:{$gt:new Date()}});
 if(!c)return res.status(401).json({error:'Sign-in expired. Refresh and retry.'});
 let p;try{p=await verify(req.body.credential);}catch{return res.status(401).json({error:'Google sign-in could not be verified.'});}
 // Production verifier checks signature, aud, iss and expiry; nonce binds to this browser challenge.
 if(!p?.sub||!p.email_verified||p.nonce!==c.nonce||!(p.email?.endsWith('@gmail.com')||p.hd))return res.status(401).json({error:'Use a verified Gmail or Google Workspace account.'});
 const previewEmails=config.previewEmails||String(process.env.TUTOR_PREVIEW_GOOGLE_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if(!live&&(!verifyGoogle||config.previewEmails)&&!previewEmails.includes(p.email.toLowerCase()))return res.status(403).json({error:'This separate test app is invite-only.'});
 let a=await Account.findOne({googleSub:p.sub});if(a?.legacyReview&&!a.tutorId&&!a.legacyLinkedAt){await Account.updateOne({_id:a._id,tutorId:null,legacyReview:true},{$set:{legacyReview:false}});a.legacyReview=false;}if(!a){const email=p.email.toLowerCase();
 try{a=await Account.create({googleSub:p.sub,email,name:clean(p.name,80),legacyReview:false});}catch(e){if(e.code!==11000)throw e;a=await Account.findOne({googleSub:p.sub});}}
 const old=cookieValue(req,sessionName);if(old)await Session.deleteOne({tokenHash:hash(old)});
 const token=random(),csrfToken=random();await Session.create({tokenHash:hash(token),accountId:a._id,csrfToken,expiresAt:new Date(Date.now()+7*86400000)});
 res.clearCookie(preName,cookieOpts);res.cookie(sessionName,token,{...cookieOpts,maxAge:7*86400000});res.json({...await accountView(a),csrfToken});}));
 r.post('/admin-console',requireSession,wrap(async(req,res)=>{if(!isAdmin(req.tutorAccount)||typeof config.issueAdminSession!=='function')return res.status(403).json({error:'Admin access required.'});res.json(config.issueAdminSession());}));
 r.get('/session',requireSession,wrap(async(req,res)=>res.json({...await accountView(req.tutorAccount),csrfToken:req.tutorSession.csrfToken})));
 r.post('/logout',requireSession,wrap(async(req,res)=>{await Session.deleteOne({_id:req.tutorSession._id});res.clearCookie(sessionName,cookieOpts);res.status(204).end();}));
 r.post('/profile',requireSession,wrap(async(req,res)=>{const a=req.tutorAccount;if(a.legacyReview)return res.status(409).json({error:'Existing registration needs a support ownership check. Do not pay again.'});
 if(a.tutorId)return res.status(409).json({error:'Profile already exists. Registration is not charged again.'});
 const p={name:clean(req.body.name,80),phone:clean(req.body.phone,10),collegeId:clean(req.body.collegeId,100),city:clean(req.body.city,80),preferredArea:clean(req.body.preferredArea,100)};
 if(!p.name||!/^\d{10}$/.test(p.phone)||!p.collegeId||!p.city||!p.preferredArea)return res.status(400).json({error:'Complete the profile with a valid 10-digit phone.'});
 // Immutable identity and paid/admin status never come from the browser.
 const t=new Tutor({...p,email:a.email,status:'pending',isPaid:false});
 try{await t.save();const linked=await Account.updateOne({_id:a._id,tutorId:null},{$set:{tutorId:t._id}});
 if(!linked.modifiedCount){await Tutor.deleteOne({_id:t._id,isPaid:false});return res.status(409).json({error:'Profile request already processed. Refresh.'});}}
 catch(e){if(e.code===11000)return res.status(409).json({error:'Registration needs a support ownership check. Do not pay again.'});throw e;}
 a.tutorId=t._id;res.status(201).json(await accountView(a));}));
 // Alert opt-in is separate from account registration and stays off until configured.
 const alertService=require('./tutor-alert-service').createAlertService({models:alertModels,Account,Tutor,Job});
 const alertsEnabled=()=>config.alertsEnabled??process.env.TUTOR_ALERTS_ENABLED==='true';
 const alertLimit=rateLimit({windowMs:600000,limit:30,standardHeaders:true,legacyHeaders:false});
 const alertGate=(req,res,next)=>alertsEnabled()?next():res.status(503).json({error:'New-lead alerts are not configured yet.'});
 r.get('/alerts',requireSession,wrap(async(req,res)=>{const {Subscription}=alertModels;res.json({enabled:alertsEnabled(),publicKey:alertsEnabled()?(config.pushPublicKey||process.env.TUTOR_PUSH_PUBLIC_KEY||''):null,devices:await Subscription.countDocuments({accountId:req.tutorAccount._id,active:true}),matching:'Saved profile city and preferred area. Masked alerts only.'});}));
 r.post('/alerts/subscription',requireSession,alertLimit,alertGate,wrap(async(req,res)=>{try{const s=await alertService.subscribe(req.tutorAccount._id,req.body);res.status(201).json({endpointHash:s.endpointHash,enabled:true});}catch{res.status(400).json({error:'Could not enable this device. Use a supported browser and a completed tutor profile.'});}}));
 r.delete('/alerts/subscription',requireSession,alertLimit,wrap(async(req,res)=>{const h=req.body.endpointHash;if(!/^[a-f0-9]{64}$/.test(h||''))return res.status(400).json({error:'Select this device subscription.'});await alertService.disable(req.tutorAccount._id,h);res.status(204).end();}));
 r.get('/leads',requireSession,wrap(async(req,res)=>{const t=req.tutorAccount.tutorId?await Tutor.findById(req.tutorAccount.tutorId):null;
 if(!isAdmin(req.tutorAccount)&&(!t||t.status!=='approved'||!t.isPaid)){if(!(pendingPolicy==='masked'&&t?.status==='pending'))return res.status(403).json({error:'Verification status view only. Board visibility awaits policy approval.'});}
 const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page)||1));const filter={status:'approved'};
 const q=clean(req.query.search,80);if(q){const rx=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{subject:rx},{location:rx},{grade:rx}];}
 const [jobs,total]=await Promise.all([Job.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*20).limit(20),Job.countDocuments(filter)]);
 const owned=await Order.find({accountId:req.tutorAccount._id,kind:'lead',status:'verified',jobId:{$in:jobs.map(j=>j._id)}}).select('jobId');const ids=new Set(owned.map(o=>id(o.jobId)));
 res.json({jobs:jobs.map(j=>({...maskJob(j),unlocked:ids.has(id(j))})),page,total,pages:Math.ceil(total/20)});}));
 r.post('/orders',requireSession,payLimit,payReady,wrap(async(req,res)=>{const a=req.tutorAccount;const t=a.tutorId?await Tutor.findById(a.tutorId):null;
 if(isAdmin(a)){if(req.body.kind!=='lead'||!mongoose.isObjectIdOrHexString(req.body.jobId))return res.status(400).json({error:'Admins open leads without payment; registration is not needed.'});
 const job=await Job.findOne({_id:req.body.jobId,status:'approved'});if(!job)return res.status(404).json({error:'Lead unavailable.'});
 await Order.updateOne({accountId:a._id,kind:'lead',resource:id(job)},{$setOnInsert:{jobId:job._id,source:'admin-access',status:'verified',amount:0,currency:'INR',verifiedAt:new Date()}},{upsert:true});
 return res.json({adminAccess:true,verified:true,message:'Admin access: lead opened without payment.'});}
 if(!t||a.legacyReview)return res.status(403).json({error:'Complete verified account linking/profile first.'});
 const kind=req.body.kind;if(!['registration','lead'].includes(kind))return res.status(400).json({error:'Invalid purchase.'});
 let job;if(kind==='registration'){if(t.isPaid)return res.status(409).json({error:'Registration is already paid. Do not pay again.'});}
 else{if(!t.isPaid||t.status!=='approved')return res.status(403).json({error:'Paid registration and approval required.'});
 if(!mongoose.isObjectIdOrHexString(req.body.jobId))return res.status(400).json({error:'Select a valid lead.'});job=await Job.findOne({_id:req.body.jobId,status:'approved'});if(!job)return res.status(404).json({error:'Lead unavailable.'});}
 const resource=kind==='registration'?id(t):id(job);const key={accountId:a._id,kind,resource};let o=await Order.findOne(key);
 if(o?.status==='verified')return res.status(409).json({error:'Already purchased. Open your history.'});
 if(o?.status==='created'){const recovered=await paymentService.reconcile(o);if(recovered.verified)return res.status(409).json({error:'Payment already verified. Refresh your account; do not pay again.'});if(recovered.pending)return res.status(409).json({error:'Payment processing. Do not pay again; retry confirmation.'});}
 if(o?.status==='created')return res.json({orderId:o.providerOrderId,amount:o.amount,currency:o.currency,keyId:config.paymentKey||process.env.RAZORPAY_KEY_ID,preview:!live});
 if(o)return res.status(409).json({error:'An order needs confirmation. Do not pay again; contact support.'});
 try{o=await Order.create({...key,tutorId:t._id,...(job?{jobId:job._id}:{}),status:'creating'});}catch(e){if(e.code===11000)return res.status(409).json({error:'Order already processing. Refresh before retrying.'});throw e;}
 try{const order=await razorpay.orders.create({amount:4900,currency:'INR',receipt:`t49_${id(o)}`,notes:{purpose:`tutor49_${kind}_v1`,accountId:id(a),tutorId:id(t),resource}});
 await Order.updateOne({_id:o._id},{$set:{providerOrderId:order.id,status:'created'}});return res.json({orderId:order.id,amount:4900,currency:'INR',keyId:config.paymentKey||process.env.RAZORPAY_KEY_ID,preview:!live});}
 catch{await Order.updateOne({_id:o._id},{$set:{status:'reconcile'}});res.status(503).json({error:'Order confirmation needs support. Do not pay again.'});}}));
 r.post('/orders/verify',requireSession,payLimit,payReady,wrap(async(req,res)=>{const {orderId,paymentId,signature}=req.body;
 if(!validPaymentSignature(orderId,paymentId,signature,paySecret))return res.status(400).json({error:'Payment proof invalid.'});
 const o=await Order.findOne({providerOrderId:orderId,accountId:req.tutorAccount._id});if(!o)return res.status(404).json({error:'Order not found for this account.'});
 if(!await paymentService.settle(o,paymentId))return res.status(409).json({error:'Payment not captured yet. Retry confirmation, not payment.'});
 res.json({verified:true,kind:o.kind,message:o.kind==='registration'?'Registration paid. Await admin verification.':'Purchase saved. Open My Unlocked Leads.'});}));
 r.post('/orders/reconcile',requireSession,payLimit,payReady,wrap(async(req,res)=>{const registration=await Order.findOne({accountId:req.tutorAccount._id,source:'provider',kind:'registration',status:'verified'});if(registration?.paymentId)await paymentService.settle(registration,registration.paymentId);const pending=await Order.find({accountId:req.tutorAccount._id,source:'provider',status:{$in:['created','reconcile']}}).sort({createdAt:1}).limit(20);let verified=0,unresolved=0;for(const o of pending){try{const r=await paymentService.reconcile(o);if(r.verified)verified++;else unresolved++;}catch{unresolved++;}}res.json({verified,unresolved,more:pending.length===20,message:verified?'Payment confirmed and saved. No repeat charge.':unresolved?'Payment confirmation still pending. Do not pay again.':'No pending payment found.'});}));
 r.get('/history',requireSession,wrap(async(req,res)=>{const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page)||1));const filter={accountId:req.tutorAccount._id,kind:'lead',status:'verified'};
 const [orders,total]=await Promise.all([Order.find(filter).sort({verifiedAt:-1,_id:-1}).skip((page-1)*20).limit(20),Order.countDocuments(filter)]);
 const jobs=await Job.find({_id:{$in:orders.map(o=>o.jobId)}}).select('+contactSuppressedAt');const byId=new Map(jobs.map(j=>[id(j),j]));
 res.json({items:orders.map(o=>{const j=byId.get(id(o.jobId));return {purchaseId:id(o),verificationType:o.source==='legacy-admin-reviewed'?'admin-reviewed-recovery':o.source==='admin-access'?'admin-access':'provider-verified',job:j&&!j.contactSuppressedAt?maskJob(j):null,purchasedAt:o.verifiedAt,contactAvailable:contactAvailable(j),availability:!j?'deleted':j.contactSuppressedAt?'restricted':contactAvailable(j)?'available':'unavailable'};}),total,page,pages:Math.ceil(total/20),legacyRecovery:true});}));
 r.get('/history/:purchaseId/contact',requireSession,wrap(async(req,res)=>{if(!mongoose.isObjectIdOrHexString(req.params.purchaseId))return res.status(404).json({error:'Purchase not found.'});
 const o=await Order.findOne({_id:req.params.purchaseId,accountId:req.tutorAccount._id,kind:'lead',status:'verified'});if(!o)return res.status(404).json({error:'Purchase not found.'});
 const j=await Job.findById(o.jobId).select('+contactSuppressedAt');if(!contactAvailable(j))return res.status(409).json({error:'Contact currently unavailable. Purchase retained; contact support.'});
 res.json({contactNumber:j.contactNumber});}));
 return r;
}
module.exports={createTutorAccountRouter,hash,maskJob};
