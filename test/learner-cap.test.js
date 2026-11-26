const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');const mongoose=require('mongoose');const {MongoMemoryServer}=require('mongodb-memory-server');const {createLearnerRouters}=require('../learner-routes');
test('quiz question cap is 150; 151 and oversize payloads are rejected; 150 Q with one 180 minute timer is stored as sent',async()=>{
 const db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('tutor49_cap'));const L=require('../models/learner');await L.Quiz.init();
 const app=express();app.use(express.json({limit:'4mb'}));const r=createLearnerRouters();app.use('/api/admin/learner',r.adminRouter);app.use('/api/learn',r.publicRouter);
 const s=await new Promise(ok=>{const x=app.listen(0,'127.0.0.1',()=>ok(x))});const B='http://127.0.0.1:'+s.address().port;
 const mk=n=>Array.from({length:n},(_,i)=>({text:'Question '+(i+1)+' text',options:['a','b','c','d'],answer:i%4,explanation:'x',section:i<50?'Paper 1':'Paper 2'}));
 const base={title:'Cap test',levels:['exam'],targets:['UGC NET'],subjects:[],kind:'full',minutes:180,marks:2,negativeMarks:0,published:false};
 try{
  const ok=await fetch(B+'/api/admin/learner/quizzes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,questions:mk(150)})});assert.equal(ok.status,201);const j=await ok.json();assert.equal(j.questionCount,150);assert.equal(j.minutes,180);assert.equal(j.sectionMinutes,0);
  const bad=await fetch(B+'/api/admin/learner/quizzes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,questions:mk(151)})});assert.equal(bad.status,400);
  const big=mk(150);big.forEach(q=>q.explanation='y'.repeat(1900));const huge=await fetch(B+'/api/admin/learner/quizzes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,questions:big})});assert.equal(huge.status,400);
 }finally{s.close();await mongoose.disconnect();await db.stop()}
});
