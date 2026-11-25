const {test}=require('node:test');const assert=require('node:assert/strict');
const {computeRank,fingerprint}=require('../learner-rank');
const Q=(a=1)=>[{text:'q1',options:['a','b'],answer:a,section:'S'}];
const mk=(acct,score,t,over={})=>({_id:acct+t,accountId:acct,score,submittedAt:new Date(2026,0,1,0,t),marks:1,negativeMarks:0,minutes:10,questions:Q(),...over});
const fp=fingerprint(mk('x',0,0));
test('ties: 90,80,80,70,60 give ranks 1,2,2,4,5 and strict-lower percentiles',()=>{
 const rows=[90,80,80,70,60].map((s,i)=>mk('u'+i,s,i));const out=rows.map(r=>computeRank(rows,r.accountId,fp,new Set()));
 assert.deepEqual(out.map(o=>o.rank),[1,2,2,4,5]);assert.deepEqual(out.map(o=>o.percentile),[100,50,50,25,0]);assert.ok(out.every(o=>o.participants===5&&o.smallCohort));});
test('single learner: rank 1 of 1, no percentile',()=>{const o=computeRank([mk('a',5,0)],'a',fp,new Set());assert.equal(o.rank,1);assert.equal(o.participants,1);assert.equal(o.percentile,null)});
test('repeat attempts: first attempt is ranked, later better score does not move it',()=>{
 const rows=[mk('a',10,0),mk('b',20,1),mk('a',99,2)];const o=computeRank(rows,'a',fp,new Set(),'a2');
 assert.equal(o.firstScore,10);assert.equal(o.rank,2);assert.equal(o.participants,2);assert.equal(o.isFirstAttempt,false);
 assert.equal(computeRank(rows,'a',fp,new Set(),'a0').isFirstAttempt,true)});
test('edited version is a separate cohort; legacy attempt without snapshot is not mixed',()=>{
 const rows=[mk('a',10,0),mk('b',50,1,{questions:Q(0)}),mk('c',50,2,{minutes:20}),mk('d',50,3,{questions:undefined})];
 const o=computeRank(rows,'a',fp,new Set());assert.equal(o.participants,1);assert.equal(o.rank,1)});
test('excluded accounts are neither ranked nor counted',()=>{
 const rows=[mk('own',100,0),mk('a',10,1),mk('b',20,2)];const ex=new Set(['own']);
 assert.equal(computeRank(rows,'own',fp,ex).available,false);const o=computeRank(rows,'a',fp,ex);assert.equal(o.participants,2);assert.equal(o.rank,2)});
test('no eligible attempt is unavailable',()=>{assert.equal(computeRank([mk('b',1,0,{questions:undefined})],'b',fp,new Set()).available,false)});
