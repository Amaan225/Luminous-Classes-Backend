// Read-only admin summary of learner sign-ups and attempts. Mounted only under the existing /api/admin authentication guard.
// Never returns questions, answers, session data, tokens, phone numbers or payment data.
const express=require('express');
function createLearnerAttemptsAdminRouter({accountModels=require('./models/tutor-account'),models=require('./models/learner-account')}={}){
 const {Account}=accountModels,{Attempt}=models,r=express.Router();
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
 r.get('/',async(req,res)=>{try{
  const since=req.query.since?new Date(String(req.query.since)):null;if(since&&isNaN(since))return res.status(400).json({error:'Invalid since.'});
  const limit=Math.min(Math.max(parseInt(req.query.limit)||200,1),500);
  const q=since?{updatedAt:{$gte:since}}:{};
  const [rows,total,byStatus,accounts]=await Promise.all([
   Attempt.find(q).select('-questions -answers -sections').sort({updatedAt:-1}).limit(limit).lean(),
   Attempt.estimatedDocumentCount(),
   Attempt.aggregate([{$group:{_id:'$status',n:{$sum:1}}}]),
   Account.find().select('email name tutorId createdAt').sort({createdAt:-1}).limit(500).lean()]);
  res.json({generatedAt:new Date().toISOString(),
   totals:{accounts:accounts.length,attempts:total,byStatus:Object.fromEntries(byStatus.map(s=>[s._id,s.n]))},
   accounts:accounts.map(a=>({accountId:String(a._id),email:a.email,name:a.name||'',tutorLinked:!!a.tutorId,createdAt:a.createdAt})),
   attempts:rows.map(a=>({attemptId:String(a._id),accountId:String(a.accountId),quizId:String(a.quizId),title:a.title,kind:a.kind,status:a.status,
    startedAt:a.startedAt,submittedAt:a.submittedAt||null,score:a.status==='submitted'?a.score:null,maxScore:a.status==='submitted'?a.maxScore:null,
    correct:a.correct??null,wrong:a.wrong??null,skipped:a.skipped??null,total:a.total??null,seconds:a.seconds??null,updatedAt:a.updatedAt})),
   truncated:rows.length===limit});
 }catch{res.status(500).json({error:'Could not read learner attempts.'})}});
 return r}
module.exports={createLearnerAttemptsAdminRouter};
