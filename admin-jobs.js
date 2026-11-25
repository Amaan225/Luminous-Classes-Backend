'use strict';
// Admin ledger paging: GET /api/admin/jobs. Mounted behind the existing admin guard. Legacy GET /api/jobs is unchanged.
const express=require('express');
const Job=require('./models/jobmodel');
const UnlockRequest=require('./models/UnlockRequest');
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const LEDGER={$or:[{status:'approved'},{status:'hidden'},{status:{$exists:false}},{status:null}]};
const ACTIVE={status:{$ne:'hidden'}};
function parse(q){
 const page=Math.max(1,Number.parseInt(q.page,10)||1);
 let limit=Number.parseInt(q.limit,10);if(!Number.isInteger(limit)||limit<1)limit=10;limit=Math.min(limit,50);
 const status=['all','active','hidden'].includes(q.status)?q.status:'all';
 const unlock=['all','unlocked','locked'].includes(q.unlock)?q.unlock:'all';
 const search=String(q.q||'').trim().slice(0,80);
 return {page,limit,status,unlock,search};
}
const statusClause=s=>s==='hidden'?{status:'hidden'}:s==='active'?ACTIVE:{};
function searchClause(search){if(!search)return {};const r=new RegExp(esc(search),'i');return {$or:[{displayId:r},{ticketId:r},{parentName:r},{title:r}]}}
function createAdminJobsRouter(){
 const r=express.Router();
 r.get('/',async(req,res)=>{
  try{
   const {page,limit,status,unlock,search}=parse(req.query);
   res.set('Cache-Control','no-store');
   // Jobs with at least one Approved unlock. The unlock collection is small and indexed by job, so this stays one cheap distinct query.
   const unlockedIds=(await UnlockRequest.distinct('jobId',{status:'Approved'})).map(String);
   const base={$and:[LEDGER,searchClause(search)]};
   const withUnlock=u=>u==='unlocked'?{_id:{$in:unlockedIds}}:u==='locked'?{_id:{$nin:unlockedIds}}:{};
   const filter={$and:[LEDGER,searchClause(search),statusClause(status),withUnlock(unlock)]};
   const [total,sAll,sActive,sHidden,uAll,uUnlocked]=await Promise.all([
    Job.countDocuments(filter),
    Job.countDocuments({$and:[base,withUnlock(unlock)]}),
    Job.countDocuments({$and:[base,ACTIVE,withUnlock(unlock)]}),
    Job.countDocuments({$and:[base,{status:'hidden'},withUnlock(unlock)]}),
    Job.countDocuments({$and:[base,statusClause(status)]}),
    Job.countDocuments({$and:[base,statusClause(status),{_id:{$in:unlockedIds}}]}),
   ]);
   const pages=Math.max(1,Math.ceil(total/limit));
   const items=await Job.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean();
   const ids=items.map(j=>j._id);
   const unlocks=ids.length?await UnlockRequest.find({jobId:{$in:ids},status:'Approved'}).sort({createdAt:-1}).lean():[];
   const by={};for(const u of unlocks)(by[String(u.jobId)]||(by[String(u.jobId)]=[])).push(u);
   const pendingCount=await Job.countDocuments({status:'pending'});
   res.status(200).json({page,pages,limit,total,pendingCount,
    counts:{status:{all:sAll,active:sActive,hidden:sHidden},unlock:{all:uAll,unlocked:uUnlocked,locked:uAll-uUnlocked}},
    items:items.map(j=>({...j,approvedUnlocks:by[String(j._id)]||[]}))});
  }catch(e){res.status(500).json({message:'Could not load the ledger.'})}
 });
 return r;
}
module.exports={createAdminJobsRouter,parse};
