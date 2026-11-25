const mongoose=require('mongoose');const {Schema}=mongoose;
// Learner-only data. Never holds tutor, payment or identity records; keyed by the shared account id.
const profile=new Schema({accountId:{type:Schema.Types.ObjectId,required:true,unique:true},target:{type:String,default:'SSC CGL',maxLength:40},prefs:{level:{type:String,maxLength:40},target:{type:String,maxLength:60},subject:{type:String,maxLength:60}},deleteRequestedAt:Date},{timestamps:true});
const question=new Schema({text:String,options:[String],answer:Number,explanation:String,section:String,image:{alt:String}},{_id:false}) // figure bytes are not copied into attempts; only the alt marker;
const attempt=new Schema({
 accountId:{type:Schema.Types.ObjectId,required:true,index:true},quizId:{type:Schema.Types.ObjectId,required:true},
 title:String,kind:String,marks:Number,negativeMarks:Number,minutes:Number,
 questions:{type:[question],select:false}, // snapshot taken at start; grading and review never read the live quiz
 startedAt:{type:Date,required:true},expiresAt:{type:Date,required:true},submittedAt:Date,
 status:{type:String,enum:['in-progress','submitted','expired'],default:'in-progress'},
 answers:[Number],correct:Number,wrong:Number,skipped:Number,total:Number,score:Number,maxScore:Number,seconds:Number,
 sections:[new Schema({name:String,correct:Number,attempted:Number,total:Number},{_id:false})]
},{timestamps:true});
attempt.index({accountId:1,status:1,submittedAt:-1});
const noteOpen=new Schema({accountId:{type:Schema.Types.ObjectId,required:true},noteId:{type:Schema.Types.ObjectId,required:true},title:String,lastOpenedAt:{type:Date,default:Date.now}});
noteOpen.index({accountId:1,noteId:1},{unique:true});
module.exports={Profile:['LearnerProfile',profile],Attempt:['LearnerAttempt',attempt],NoteOpen:['LearnerNoteOpen',noteOpen]};
