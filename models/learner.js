const mongoose=require('mongoose');
const {Schema}=mongoose;
const common={title:{type:String,required:true,maxLength:120},description:{type:String,default:'',maxLength:1000},levels:[String],targets:[String],subjects:[String],topic:{type:String,default:'',maxLength:80},published:{type:Boolean,default:false}};
const note=new Schema({...common,pdf:{type:Buffer,select:false},bytes:{type:Number,default:0},pages:Number,sha256:String},{timestamps:true});
const quiz=new Schema({...common,minutes:{type:Number,min:1,max:180,default:20},questions:{type:[new Schema({text:{type:String,required:true},options:[String],answer:Number,explanation:String},{_id:false})],default:[]}},{timestamps:true});
const quota=new Schema({_id:String,bytes:{type:Number,default:0}});
module.exports={Note:mongoose.models.LearnerNote||mongoose.model('LearnerNote',note),Quiz:mongoose.models.LearnerQuiz||mongoose.model('LearnerQuiz',quiz),Quota:mongoose.models.LearnerQuota||mongoose.model('LearnerQuota',quota)};
