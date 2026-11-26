const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');const mongoose=require('mongoose');const {MongoMemoryServer}=require('mongodb-memory-server');const {createLearnerRouters}=require('../learner-routes');
test('full tests accept an optional difficulty; pyq and sample still reject it; unrated stays unrated',async()=>{
 const db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('tutor49_band'));const L=require('../models/learner');await L.Quiz.init();
 const app=express();app.use(express.json({limit:'4mb'}));const r=createLearnerRouters();app.use('/api/admin/learner',r.adminRouter);app.use('/api/learn',r.publicRouter);
 const s=await new Promise(ok=>{const x=app.listen(0,'127.0.0.1',()=>ok(x))});const B='http://127.0.0.1:'+s.address().port;
 const qs=[{text:'2+2?',options:['1','2','3','4'],answer:3,explanation:'x'}];
 const base={title:'Band',levels:['exam'],targets:['SSC CGL'],subjects:[],kind:'full',minutes:60,marks:2,negativeMarks:0.5,published:false,questions:qs};
 const post=b=>fetch(B+'/api/admin/learner/quizzes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  const a=await post({...base,difficulty:'easy'});assert.equal(a.status,201);assert.equal((await a.json()).difficulty,'easy');
  const u=await post({...base,title:'Unrated'});assert.equal(u.status,201);assert.equal((await u.json()).difficulty,'');
  assert.equal((await post({...base,difficulty:'brutal'})).status,400);
  assert.equal((await post({...base,kind:'pyq',difficulty:'easy'})).status,400);
  assert.equal((await post({...base,kind:'sample',difficulty:'easy'})).status,400);
 }finally{s.close();await mongoose.disconnect();await db.stop()}
});
