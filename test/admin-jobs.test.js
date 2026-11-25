const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {createAdminJobsRouter}=require('../admin-jobs');
const Job=require('../models/jobmodel'),Unlock=require('../models/UnlockRequest');
let db,server,base,ids=[];
before(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('tutor49_test'));
 const app=express();app.use('/api/admin/jobs',createAdminJobsRouter());server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/admin/jobs`;
 for(let i=0;i<25;i++){const j=await Job.create({parentName:'Parent '+i,contactNumber:'9999999999',title:'Class '+i,subject:'Maths',grade:'8',city:'Lucknow',location:'L',salary:1000+i,requirements:'r',displayId:'TK-'+(100+i),status:i<5?'hidden':i===24?'pending':'approved',createdAt:new Date(2026,10,1+i)});ids.push(j._id)}
 await Unlock.create({jobId:ids[10],tutorPhone:'9',transactionId:'t',status:'Approved'});
 await Unlock.create({jobId:ids[11],tutorPhone:'9',transactionId:'t2',status:'Pending'})});
after(async()=>{await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop()});
const get=async q=>(await fetch(base+q)).json();
test('pages of 10, newest first, pending leads excluded from ledger',async()=>{const a=await get('?page=1');assert.equal(a.items.length,10);assert.equal(a.total,24);assert.equal(a.pages,3);assert.equal(a.pendingCount,1);assert.equal(a.items[0].displayId,'TK-123');const c=await get('?page=3');assert.equal(c.items.length,4);assert.equal(c.items.at(-1).displayId,'TK-100');assert.equal(a.counts.status.all,24);assert.equal(a.counts.status.active,19);assert.equal(a.counts.status.hidden,5)});
test('limit is capped and bad paging falls back',async()=>{assert.equal((await get('?limit=9999')).items.length,24);assert.equal((await get('?page=abc&limit=-3')).items.length,10)});
test('search, status and unlock filters with facet counts',async()=>{const s=await get('?q=tk-110');assert.equal(s.total,1);assert.equal(s.items[0].approvedUnlocks.length,1);assert.equal((await get('?q=.*')).total,0);
 const h=await get('?status=hidden');assert.equal(h.total,5);assert.equal(h.counts.unlock.all,5);
 const u=await get('?unlock=unlocked');assert.equal(u.total,1);assert.equal(u.counts.status.all,1);const l=await get('?unlock=locked');assert.equal(l.total,23);
 const both=await get('?status=hidden&unlock=unlocked');assert.equal(both.total,0)});
test('pending Unlock does not count as unlocked',async()=>{const r=await get('?q=TK-111');assert.equal(r.items[0].approvedUnlocks.length,0)});

test('view=pending returns only pending leads',async()=>{const r=await get('?view=pending');assert.equal(r.items.length,1);assert.equal(r.items[0].displayId,'TK-124')});
