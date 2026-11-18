const mongoose = require('mongoose');
const { Schema } = mongoose;
const accountSchema = new Schema({
  googleSub: {type:String,required:true,unique:true},
  email: {type:String,required:true},
  name: String,
  tutorId: {type:Schema.Types.ObjectId,ref:'Tutor',default:null},
  legacyReview: {type:Boolean,default:false}, legacyLinkedAt:Date, legacyLinkReference:String
},{timestamps:true});
// An existing paid profile can only belong to one account after reviewed linking.
accountSchema.index({tutorId:1},{unique:true,partialFilterExpression:{tutorId:{$type:'objectId'}}});
const sessionSchema = new Schema({
  tokenHash: {type:String,required:true,unique:true},
  accountId:{type:Schema.Types.ObjectId,ref:'TutorAccount',required:true},
  csrfToken:{type:String,required:true},expiresAt:{type:Date,required:true}
});
sessionSchema.index({expiresAt:1},{expireAfterSeconds:0});
const challengeSchema = new Schema({tokenHash:{type:String,required:true,unique:true},nonce:String,expiresAt:Date});
challengeSchema.index({expiresAt:1},{expireAfterSeconds:0});
const orderSchema = new Schema({
  accountId:{type:Schema.Types.ObjectId,ref:'TutorAccount',required:true},
  tutorId:{type:Schema.Types.ObjectId,ref:'Tutor',required:true},
  kind:{type:String,enum:['registration','lead'],required:true},
  resource:{type:String,required:true},
  jobId:{type:Schema.Types.ObjectId,ref:'Job'},
  providerOrderId:String,paymentId:String,
  source:{type:String,enum:['provider','legacy-admin-reviewed'],default:'provider'},
  legacyUnlockId:Schema.Types.ObjectId,legacyTransactionId:String,reviewReference:String,reviewedAt:Date,
  status:{type:String,enum:['creating','created','verified','reconcile'],default:'creating'},
  amount:{type:Number,default:4900},currency:{type:String,default:'INR'},verifiedAt:Date
},{timestamps:true});
orderSchema.index({accountId:1,kind:1,resource:1},{unique:true});
orderSchema.index({legacyUnlockId:1},{unique:true,partialFilterExpression:{legacyUnlockId:{$type:'objectId'}}});
orderSchema.index({providerOrderId:1},{unique:true,partialFilterExpression:{providerOrderId:{$type:'string'}}});
orderSchema.index({paymentId:1},{unique:true,partialFilterExpression:{paymentId:{$type:'string'}}});
module.exports={Account:['TutorAccount',accountSchema],Session:['TutorSession',sessionSchema],Challenge:['TutorLoginChallenge',challengeSchema],Order:['TutorAccountOrder',orderSchema]};
