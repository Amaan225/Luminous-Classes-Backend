const express=require('express');const {rankFor}=require('./learner-rank');const crypto=require('crypto');const rateLimit=require('express-rate-limit');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const cookieValue=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const GRACE_MS=30000,MAX_ATTEMPTS=Number(process.env.LEARNER_ATTEMPT_CAP)||0; // 0 = no cap. Retention cap is an undecided product policy.
const idOK=v=>/^[a-f\d]{24}$/i.test(String(v));
const IST=ms=>new Date(ms+19800000).toISOString().slice(0,10);
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(()=>res.status(500).json({error:'Could not complete this request. Please retry.'}));
function grade(q,answers){let correct=0,wrong=0,skipped=0;const sec=new Map();q.questions.forEach((x,i)=>{const a=answers[i];const attempted=Number.isInteger(a)&&a>=0&&a<x.options.length;const name=x.section||'';const s=sec.get(name)||{name,correct:0,attempted:0,total:0};s.total++;if(attempted){s.attempted++;if(a===x.answer){correct++;s.correct++}else wrong++}else skipped++;sec.set(name,s)});
 const marks=q.marks||1,neg=q.negativeMarks||0;return {correct,wrong,skipped,total:q.questions.length,score:Math.round((correct*marks-wrong*neg)*100)/100,maxScore:q.questions.length*marks,sections:[...sec.values()]}}
function bounds(qs){const b=[];qs.forEach((q,i)=>{const n=q.section||'';if(!b.length||b[b.length-1].name!==n)b.push({name:n,from:i,to:i+1});else b[b.length-1].to=i+1});return b}
// Sectioned attempts: section i runs from the previous section's end (or its early finish) for at most sectionMinutes. Everything is derived from server timestamps.
function secState(at,now){if(!at.sectionMinutes||!at.sectionBounds?.length)return null;const len=at.sectionMinutes*60000,starts=[],ends=[];let st=+at.startedAt;at.sectionBounds.forEach((_,i)=>{const lk=at.sectionLockedAt?.[i];const en=Math.min(st+len,lk?Math.max(+lk,st):Infinity);starts.push(st);ends.push(en);st=en});let cur=ends.findIndex(e=>e>now);if(cur<0)cur=ends.length;return {starts,ends,cur}}
const SECTION_GRACE_MS=5000;
function secPayload(at,now){const st=secState(at,now);if(!st)return {};return {sectionMinutes:at.sectionMinutes,currentSection:st.cur,expiresAt:at.expiresAt,secondsLeft:Math.max(0,Math.round((at.expiresAt-now)/1000)),sections:at.sectionBounds.map((b,i)=>({name:b.name,from:b.from,to:b.to,startsAt:new Date(st.starts[i]),endsAt:new Date(st.ends[i]),finished:!!at.sectionLockedAt?.[i]||st.ends[i]<=now,saved:at.sectionAnswers?.[i]||null}))}}
function createLearnerAccountRouter({accountModels=require('./models/tutor-account'),learnerModels=require('./models/learner'),models=require('./models/learner-account'),config={}}={}){
 const {Account,Session}=accountModels;const {Quiz,Note}=learnerModels;const {Profile,Attempt,NoteOpen}=models;const r=express.Router();
 const enabled=config.enabled??process.env.TUTOR_ACCOUNTS_ENABLED==='true';
 const origins=config.origins||String(process.env.TUTOR_ACCOUNT_ORIGINS||'').split(',').filter(Boolean);
 const secure=config.secure??true,ns=config.cookieNamespace||'t49';if(!['t49','t49test'].includes(ns))throw Error('Invalid account cookie namespace');
 const sessionName=(secure?'__Host-':'')+ns+'session';
 r.use(rateLimit({windowMs:60000,limit:config.limit||120,standardHeaders:true,legacyHeaders:false}));
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!enabled)return res.status(404).json({error:'Learner accounts are not enabled.'});
  const origin=req.get('Origin');if(origin&&!origins.includes(origin))return res.status(403).json({error:'Origin not allowed.'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!origin||!origins.includes(origin)))return res.status(403).json({error:'Trusted site origin required.'});next()});
 // Same cookie, same session store and same CSRF rule as the tutor account router. Read-only on accounts: this router never writes tutor fields.
 r.use(wrap(async(req,res,next)=>{const t=cookieValue(req,sessionName);if(!/^[\w-]{43}$/.test(t))return res.status(401).json({error:'Please sign in.'});
  const s=await Session.findOne({tokenHash:hash(t),expiresAt:{$gt:new Date()}});if(!s)return res.status(401).json({error:'Please sign in again.'});
  const a=await Account.findById(s.accountId);if(!a)return res.status(401).json({error:'Please sign in again.'});
  if(!['GET','HEAD'].includes(req.method)&&req.get('X-CSRF-Token')!==s.csrfToken)return res.status(403).json({error:'Refresh the page and retry.'});
  req.acct=a;req.sess=s;const p=await Profile.findOneAndUpdate({accountId:a._id},{$setOnInsert:{accountId:a._id}},{upsert:true,new:true,setDefaultsOnInsert:true});
  req.profile=p;
  if(p.deleteRequestedAt&&!(req.method==='POST'&&req.path==='/data/delete-cancel')&&!(req.method==='GET'&&['/me','/data/export'].includes(req.path)))return res.status(423).json({error:'Learner data deletion is pending. Cancel it to continue.',deleteRequestedAt:p.deleteRequestedAt});
  next()}));
 const view=(a,p)=>({name:a.name||'',target:p.target,prefs:p.prefs?.level?{level:p.prefs.level,target:p.prefs.target,subject:p.prefs.subject}:null,deleteRequestedAt:p.deleteRequestedAt||null});
 r.put('/preferences',wrap(async(req,res)=>{const b=req.body||{},o={};for(const k of ['level','target','subject']){if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>60)return res.status(400).json({error:'Invalid preference.'});o['prefs.'+k]=b[k].trim()}await Profile.updateOne({_id:req.profile._id},{$set:o});res.json({ok:true})}));
 r.get('/me',wrap(async(req,res)=>res.json(view(req.acct,req.profile))));
 r.post('/attempts/start',wrap(async(req,res)=>{const id=req.body?.quizId;if(!idOK(id))return res.status(400).json({error:'Choose a practice set.'});
  const quiz=await Quiz.findOne({_id:id,published:true});if(!quiz)return res.status(404).json({error:'This practice set is no longer available.'});
  const now=Date.now();let at=await Attempt.findOne({accountId:req.acct._id,quizId:quiz._id,status:'in-progress',expiresAt:{$gt:new Date(now)}}).select('+questions');
  if(!at){await Attempt.updateMany({accountId:req.acct._id,quizId:quiz._id,status:'in-progress',expiresAt:{$lte:new Date(now)}},{$set:{status:'expired'}});
   if(MAX_ATTEMPTS&&await Attempt.countDocuments({accountId:req.acct._id})>=MAX_ATTEMPTS)return res.status(409).json({error:'Attempt history is full.'});
   at=await Attempt.create({accountId:req.acct._id,quizId:quiz._id,title:quiz.title,kind:quiz.kind,marks:quiz.marks,negativeMarks:quiz.negativeMarks,minutes:quiz.minutes,questions:quiz.questions.map(q=>q.toObject?q.toObject():q),...(quiz.sectionMinutes>0?{sectionMinutes:quiz.sectionMinutes,sectionBounds:bounds(quiz.questions),sectionLockedAt:bounds(quiz.questions).map(()=>null),sectionAnswers:[]}:{}),startedAt:new Date(now),expiresAt:new Date(now+quiz.minutes*60000)})}
  const f=await figures(at);res.status(201).json({attemptId:String(at._id),title:at.title,minutes:at.minutes,marks:at.marks,negativeMarks:at.negativeMarks,startedAt:at.startedAt,expiresAt:at.expiresAt,secondsLeft:Math.max(0,Math.round((at.expiresAt-now)/1000)),...secPayload(at,now),
   questions:at.questions.map((q,i)=>({text:q.text,options:q.options,section:q.section||'',...(f[i]?{image:f[i]}:{})}))})}));
 r.get('/attempts/:id/state',wrap(async(req,res)=>{if(!idOK(req.params.id))return res.status(404).end();
  const at=await Attempt.findOne({_id:req.params.id,accountId:req.acct._id});if(!at||!at.sectionMinutes)return res.status(404).end();
  const now=Date.now();res.json({status:at.status,...(at.status==='in-progress'&&now<=at.expiresAt.getTime()+GRACE_MS?secPayload(at,now):{}),serverNow:now})}));
 r.post('/attempts/:id/section',wrap(async(req,res)=>{if(!idOK(req.params.id))return res.status(404).end();
  const at=await Attempt.findOne({_id:req.params.id,accountId:req.acct._id,status:'in-progress'});if(!at||!at.sectionMinutes)return res.status(404).end();
  const now=Date.now(),st=secState(at,now),i=req.body?.section,a=req.body?.answers,fin=req.body?.finish===true;
  if(!Number.isInteger(i)||i<0||i>=at.sectionBounds.length||!Array.isArray(a))return res.status(400).json({error:'Invalid section.'});
  const b=at.sectionBounds[i];if(a.length!==b.to-b.from||a.some(v=>v!==null&&!(Number.isInteger(v)&&v>=0&&v<4)))return res.status(400).json({error:'Invalid answers.'});
  // A section that was already finished is immutable. Repeating a finish is idempotent (a lost response can be retried); it never rewrites saved answers.
  if(at.sectionLockedAt?.[i]){return res.status(fin?200:409).json({ok:fin,locked:true,error:fin?undefined:'This section is finished.',...secPayload(at,now)})}
  if(now>at.expiresAt.getTime()+GRACE_MS||now>st.ends[i]+SECTION_GRACE_MS||st.cur<i)return res.status(409).json({error:'This section is closed.',locked:true,...secPayload(at,now)});
  if(fin&&(st.cur!==i||i===at.sectionBounds.length-1))return res.status(409).json({error:'This section is closed.',locked:true,...secPayload(at,now)});
  const set={['sectionAnswers.'+i]:a};if(fin)set['sectionLockedAt.'+i]=new Date(now);
  const ok=await Attempt.updateOne({_id:at._id,status:'in-progress',['sectionLockedAt.'+i]:null},{$set:set});
  const fresh=await Attempt.findById(at._id);if(!ok.matchedCount)return res.status(fin?200:409).json({ok:fin,locked:true,...secPayload(fresh,now)});
  res.json({ok:true,...secPayload(fresh,now)})}));
 r.post('/attempts/:id/submit',wrap(async(req,res)=>{if(!idOK(req.params.id))return res.status(404).end();
  const at=await Attempt.findOne({_id:req.params.id,accountId:req.acct._id}).select('+questions');if(!at)return res.status(404).end();
  if(at.status==='submitted')return res.status(409).json({error:'Already submitted.'});
  const now=Date.now();if(now>at.expiresAt.getTime()+GRACE_MS){await Attempt.updateOne({_id:at._id,status:'in-progress'},{$set:{status:'expired'}});return res.status(409).json({error:'Time is up. This attempt was not saved.'})}
  const a=req.body?.answers;if(!Array.isArray(a)||a.length>at.questions.length||a.some(v=>v!==null&&!Number.isInteger(v)))return res.status(400).json({error:'Invalid answers.'});
  let fin=a;{const st=secState(at,now);if(st){fin=Array(at.questions.length).fill(null);at.sectionBounds.forEach((b,i)=>{const open=i===st.cur||(i===at.sectionBounds.length-1&&st.cur>=at.sectionBounds.length&&!at.sectionLockedAt?.[i]);const src=open?a.slice(b.from,b.to):(at.sectionAnswers?.[i]||[]);for(let k=b.from;k<b.to;k++){const v=src[open?k-b.from:k-b.from];fin[k]=Number.isInteger(v)?v:null}})}}
  const g=grade(at,fin);const seconds=Math.min(Math.round((now-at.startedAt)/1000),at.minutes*60);
  const done=await Attempt.findOneAndUpdate({_id:at._id,status:'in-progress'},{$set:{status:'submitted',submittedAt:new Date(now),answers:fin.map(v=>v===null?-1:v),...g,seconds}},{new:true});
  if(!done)return res.status(409).json({error:'Already submitted.'});res.json({...reviewOf(at,done,await figures(at)),rank:await rankFor(Attempt,{...at.toObject(),_id:done._id,accountId:done.accountId,quizId:done.quizId})})}));
 // Figures live on the quiz once. An attempt keeps the alt marker and gets the picture only while the quiz still has the same figure.
 const figures=async at=>{if(!at.questions.some(q=>q.image?.alt))return[];const live=await Quiz.findById(at.quizId).select('questions.image');return at.questions.map((q,i)=>{const li=live?.questions?.[i]?.image;return q.image?.alt&&li&&li.alt===q.image.alt?{src:li.src,alt:li.alt}:undefined})};
 const reviewOf=(q,d,f=[])=>({attemptId:String(d._id),title:d.title,score:d.score,maxScore:d.maxScore,correct:d.correct,wrong:d.wrong,skipped:d.skipped,total:d.total,seconds:d.seconds,submittedAt:d.submittedAt,
  questions:q.questions.map((x,i)=>({text:x.text,options:x.options,section:x.section||'',chosen:d.answers[i]>=0?d.answers[i]:null,answer:x.answer,explanation:x.explanation,...(f[i]?{image:f[i]}:{})}))});
 const row=d=>({attemptId:String(d._id),title:d.title,kind:d.kind,score:d.score,maxScore:d.maxScore,correct:d.correct,wrong:d.wrong,skipped:d.skipped,total:d.total,seconds:d.seconds,submittedAt:d.submittedAt});
 r.get('/attempts',wrap(async(req,res)=>{const l=Math.min(Math.max(parseInt(req.query.limit)||20,1),100);const rows=await Attempt.find({accountId:req.acct._id,status:'submitted'}).sort({submittedAt:-1}).limit(l);res.json({attempts:rows.map(row)})}));
 r.get('/attempts/:id',wrap(async(req,res)=>{if(!idOK(req.params.id))return res.status(404).end();const d=await Attempt.findOne({_id:req.params.id,accountId:req.acct._id,status:'submitted'}).select('+questions');if(!d)return res.status(404).end();res.json({...reviewOf(d,d,await figures(d)),rank:await rankFor(Attempt,d.toObject())})}));
 r.get('/dashboard',wrap(async(req,res)=>{const rows=await Attempt.find({accountId:req.acct._id,status:'submitted'}).sort({submittedAt:-1});const n=rows.length;
  if(!n)return res.json({empty:true,tests:0});
  let correct=0,wrong=0,seconds=0;const sec=new Map(),days=new Set(),week=new Map();const now=Date.now();
  for(const d of rows){correct+=d.correct;wrong+=d.wrong;seconds+=d.seconds||0;days.add(IST(d.submittedAt.getTime()));for(const s of d.sections){if(!s.name)continue;const x=sec.get(s.name)||{name:s.name,correct:0,attempted:0};x.correct+=s.correct;x.attempted+=s.attempted;sec.set(s.name,x)}}
  for(let i=6;i>=0;i--)week.set(IST(now-i*86400000),0);for(const d of rows){const k=IST(d.submittedAt.getTime());if(week.has(k))week.set(k,week.get(k)+1)}
  let streak=0;for(let i=days.has(IST(now))?0:1;days.has(IST(now-i*86400000));i++)streak++;
  res.json({empty:false,tests:n,accuracy:correct+wrong?Math.round(100*correct/(correct+wrong)):null,minutes:Math.round(seconds/60),streak,
   week:[...week].map(([date,tests])=>({date,tests})),sections:[...sec.values()].filter(s=>s.attempted>=5).map(s=>({name:s.name,accuracy:Math.round(100*s.correct/s.attempted),attempted:s.attempted})),recent:rows.slice(0,5).map(row)})}));
 r.get('/notes',wrap(async(req,res)=>{const rows=await NoteOpen.find({accountId:req.acct._id}).sort({lastOpenedAt:-1}).limit(50);res.json({notes:rows.map(x=>({id:String(x.noteId),title:x.title,lastOpenedAt:x.lastOpenedAt}))})}));
 r.get('/notes/:id/download',wrap(async(req,res)=>{if(!idOK(req.params.id))return res.status(404).end();const n=await Note.findOne({_id:req.params.id,published:true}).select('+pdf');if(!n?.pdf)return res.status(404).json({error:'This note is not available.'});
  await NoteOpen.updateOne({accountId:req.acct._id,noteId:n._id},{$set:{title:n.title,lastOpenedAt:new Date()}},{upsert:true});
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Tutor49-notes.pdf"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}).send(n.pdf)}));
 r.get('/data/export',wrap(async(req,res)=>{const [attempts,notes]=await Promise.all([Attempt.find({accountId:req.acct._id,status:'submitted'}).sort({submittedAt:-1}),NoteOpen.find({accountId:req.acct._id})]);
  res.set('Content-Disposition','attachment; filename="tutor49-learner-data.json"').json({profile:view(req.acct,req.profile),attempts:attempts.map(row),notesOpened:notes.map(x=>({title:x.title,lastOpenedAt:x.lastOpenedAt}))})}));
 // Learner data only. Never touches the shared account, sessions, tutor profile or payment records.
 r.post('/data/delete-request',wrap(async(req,res)=>{await Profile.updateOne({_id:req.profile._id},{$set:{deleteRequestedAt:new Date()}});res.status(202).json({pending:true})}));
 r.post('/data/delete-cancel',wrap(async(req,res)=>{await Profile.updateOne({_id:req.profile._id},{$unset:{deleteRequestedAt:1}});res.json({pending:false})}));
 return r}
// Final purge for requests older than graceMs. Not scheduled anywhere: the grace period is an open product decision.
async function purgeDeletedLearnerData({models=require('./models/learner-account'),graceMs,now=Date.now()}){if(!(graceMs>=0))throw Error('graceMs required');
 const due=await models.Profile.find({deleteRequestedAt:{$lte:new Date(now-graceMs)}});let purged=0;
 for(const p of due){await models.Attempt.deleteMany({accountId:p.accountId});await models.NoteOpen.deleteMany({accountId:p.accountId});await models.Profile.deleteOne({_id:p._id});purged++}return purged}
module.exports={createLearnerAccountRouter,purgeDeletedLearnerData,grade};
