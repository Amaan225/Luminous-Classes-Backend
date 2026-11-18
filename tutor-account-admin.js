// Mounted only under the existing /api/admin authentication guard.
const express=require('express');
const mongoose=require('mongoose');
function createTutorAccountAdminRouter({models=require('./models/tutor-account'),Tutor=require('./models/tutor'),Unlock=require('./models/UnlockRequest')}={}){
 const {Account,Order,Session}=models,r=express.Router();
 const oid=v=>typeof v==='string'&&mongoose.isObjectIdOrHexString(v);
 const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>res.status(e.code===11000?409:500).json({error:e.code===11000?'Already linked or recovered. No changes made.':'Could not complete account review.'}));
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
 r.get('/',wrap(async(req,res)=>{const accounts=await Account.find().select('email name tutorId legacyReview createdAt').sort({createdAt:-1}).limit(100);
 const tutors=await Tutor.find().select('name email phone status isPaid').limit(100);
 const legacyUnlocks=await Unlock.find().select('jobId tutorPhone transactionId status createdAt').sort({createdAt:-1}).limit(100);
 const recovered=await Order.find({legacyUnlockId:{$exists:true}}).select('legacyUnlockId accountId');
 res.json({accounts,tutors,legacyUnlocks,recovered});}));
 r.post('/link-registration',wrap(async(req,res)=>{const {accountId,tutorId,reference,ownershipVerified}=req.body;
 if(!oid(accountId)||!oid(tutorId)||ownershipVerified!==true||typeof reference!=='string'||reference.trim().length<12||reference.length>300)return res.status(400).json({error:'Explicit ownership confirmation and a support evidence reference are required.'});
 const [a,t]=await Promise.all([Account.findById(accountId),Tutor.findById(tutorId)]);if(!a||!t)return res.status(404).json({error:'Account or registration not found.'});
 if(a.tutorId)return res.status(409).json({error:'Account already has a profile. No merge performed.'});
 const linked=await Account.updateOne({_id:a._id,tutorId:null},{$set:{tutorId:t._id,legacyReview:false,legacyLinkedAt:new Date(),legacyLinkReference:reference.trim()}});
 if(!linked.modifiedCount)return res.status(409).json({error:'Account changed. Refresh before retrying.'});
 // Existing registration _id, paid status, approval and original payment fields are untouched.
 await Session.deleteMany({accountId:a._id});res.json({linked:true,message:'Registration linked. Tutor must sign in again.'});}));
 r.post('/recover-purchase',wrap(async(req,res)=>{const {accountId,unlockId,ownershipVerified,paymentVerified,reference}=req.body;
 if(!oid(accountId)||!oid(unlockId)||ownershipVerified!==true||paymentVerified!==true||typeof reference!=='string'||reference.trim().length<12||reference.length>300)return res.status(400).json({error:'Ownership, original payment evidence and support reference must be reviewed explicitly.'});
 const [a,u]=await Promise.all([Account.findById(accountId),Unlock.findById(unlockId)]);
 if(!a?.tutorId||!u||u.status!=='Approved')return res.status(409).json({error:'Linked account and original Approved unlock required. No contact disclosed.'});
 const existing=await Order.findOne({$or:[{legacyUnlockId:u._id},{accountId:a._id,kind:'lead',resource:String(u.jobId)}]});
 if(existing)return res.status(409).json({error:'This purchase/lead is already linked. No duplicate created.'});
 await Order.create({accountId:a._id,tutorId:a.tutorId,kind:'lead',resource:String(u.jobId),jobId:u.jobId,status:'verified',source:'legacy-admin-reviewed',legacyUnlockId:u._id,legacyTransactionId:u.transactionId,reviewReference:reference.trim(),reviewedAt:new Date(),verifiedAt:u.createdAt||new Date(),amount:4900,currency:'INR'});
 res.status(201).json({recovered:true,message:'History restored from reviewed legacy evidence. Original unlock unchanged; no new charge.'});}));
 return r;
}
module.exports={createTutorAccountAdminRouter};
