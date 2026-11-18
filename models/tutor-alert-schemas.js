const mongoose=require('mongoose');
const {Schema}=mongoose;
const subscription=new Schema({accountId:{type:Schema.Types.ObjectId,required:true,index:true},endpoint:{type:String,required:true,unique:true,select:false},endpointHash:{type:String,required:true,unique:true},keys:{p256dh:{type:String,select:false},auth:{type:String,select:false}},active:{type:Boolean,default:true},enabledAt:{type:Date,default:Date.now}},{timestamps:true});
const delivery=new Schema({subscriptionId:{type:Schema.Types.ObjectId,required:true},accountId:{type:Schema.Types.ObjectId,required:true},jobId:{type:Schema.Types.ObjectId,required:true},optInAt:Date,status:{type:String,enum:['pending','sending','sent','skipped','expired'],default:'pending'},attempts:{type:Number,default:0},nextAttemptAt:{type:Date,default:Date.now},leaseToken:String,leaseUntil:Date,finishedAt:Date},{timestamps:true});
delivery.index({subscriptionId:1,jobId:1},{unique:true});delivery.index({status:1,nextAttemptAt:1,leaseUntil:1});
module.exports={Subscription:['TutorPushSubscription',subscription],Delivery:['TutorPushDelivery',delivery]};
