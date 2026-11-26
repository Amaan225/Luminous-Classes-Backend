// Private own-result rank for a learner. Pure functions plus one bounded query helper.
const crypto=require('crypto');
// Owner/staff accounts that must not appear in a cohort. Stable account ids only, and only ids confirmed by exact record.
// Amaan (2 exact-address matches) and Faiz (2, confirmed by his own Instinct against his original messages). Staff ids are added once confirmed. Name or email guesses never go in this list.
const EXCLUDED_ACCOUNT_IDS=new Set(['6b0188b4203e838f44d9ec66','6afd7065dba5129714214d09','6afd6b5ddba5129714214cfe','6afd5a57050714600db27d86']);
const COHORT_CAP=1000,SMALL_COHORT=10;
const fingerprint=q=>{if(!q||!Array.isArray(q.questions)||!q.questions.length)return null;
 return crypto.createHash('sha256').update(JSON.stringify({m:q.marks,n:q.negativeMarks,...(q.sectionNegativeMarks?.length?{sn:q.sectionNegativeMarks}:{}),...(q.sectionMarks?.length?{sk:q.sectionMarks,nr:q.negativeRatio||0}:{}),t:q.minutes,q:q.questions.map(x=>[x.text,x.options,x.answer,x.section||''])})).digest('hex')};
// rows: submitted attempts of one quiz with questions snapshot. Returns the rank view for `acctId`.
function computeRank(rows,acctId,fp,excluded=EXCLUDED_ACCOUNT_IDS,attemptId=null){
 const me=String(acctId);if(excluded.has(me))return {available:false,reason:'not-ranked'};
 const first=new Map();
 for(const r of [...rows].sort((a,b)=>new Date(a.submittedAt)-new Date(b.submittedAt))){
  const a=String(r.accountId);if(excluded.has(a)||fingerprint(r)!==fp||first.has(a))continue;first.set(a,r)}
 const mine=first.get(me);if(!mine)return {available:false,reason:'no-eligible-attempt'};
 const scores=[...first.values()].map(r=>r.score),N=scores.length,s=mine.score;
 const rank=1+scores.filter(x=>x>s).length,lower=scores.filter(x=>x<s).length;
 return {available:true,rank,participants:N,percentile:N>1?Math.round(100*lower/(N-1)*10)/10:null,firstScore:s,isFirstAttempt:attemptId==null||String(mine._id)===String(attemptId),smallCohort:N<SMALL_COHORT,basis:'first eligible attempt by each learner on this exact version of the test'}}
async function rankFor(Attempt,attempt){
 try{const fp=fingerprint(attempt);if(!fp)return {available:false,reason:'no-snapshot'};
  const rows=await Attempt.find({quizId:attempt.quizId,status:'submitted'}).select('+questions accountId submittedAt score marks negativeMarks sectionNegativeMarks sectionMarks negativeRatio minutes').sort({submittedAt:1}).limit(COHORT_CAP+1).lean();
  if(rows.length>COHORT_CAP)return {available:false,reason:'cohort-too-large'};
  return computeRank(rows,attempt.accountId,fp,EXCLUDED_ACCOUNT_IDS,attempt._id)}catch{return {available:false,reason:'unavailable'}}}
module.exports={computeRank,rankFor,fingerprint,EXCLUDED_ACCOUNT_IDS,COHORT_CAP,SMALL_COHORT};
