const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createAdminAuth, SESSION_MS } = require('../admin-auth');
const { validPaymentSignature, verifyLeadPayment } = require('../payment-verification');
const password = 'local-test-password-only';
const salt = '0123456789abcdef0123456789abcdef';
const hash = `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
let server, base;
before(async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_local';
  process.env.RAZORPAY_KEY_SECRET = 'local-test-secret';
  process.env.ADMIN_PASSWORD_HASH = hash;
  const app = require('../server');
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));
const request = (path, method = 'GET', body, token) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
test('all private route families reject missing tokens before database access', async () => {
  for (const [path, method] of [['/api/admin/tutors/pending','GET'], ['/api/admin/tutors/000000000000000000000001/status','PUT'], ['/api/jobs/000000000000000000000001','PUT'], ['/api/jobs/000000000000000000000001','DELETE'], ['/api/unlocks','GET'], ['/api/unlocks/000000000000000000000001/approve','PUT']]) {
    assert.equal((await request(path, method, method === 'GET' ? undefined : {})).status, 401, `${method} ${path}`);
  }
});
test('password login, one-hour session, logout revocation and forged-token rejection', async () => {
  assert.equal((await request('/api/admin/login','POST',{ password: 'wrong' })).status,401);
  const response = await request('/api/admin/login','POST',{password});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const {token, expiresAt} = await response.json();
  assert.equal(token.length,43);
  assert.ok(expiresAt > Date.now() + SESSION_MS - 3000);
  assert.equal((await request('/api/admin/session','GET',undefined,token)).status,200);
  assert.equal((await request('/api/admin/session','GET',undefined,'x'.repeat(43))).status,401);
  assert.equal((await request('/api/admin/logout','POST',{},token)).status,204);
  assert.equal((await request('/api/admin/session','GET',undefined,token)).status,401);
});
test('expired tokens are rejected and absent config fails closed', async () => {
  const auth = createAdminAuth(hash);
  let token;
  await auth.login({body:{password}}, {set(){return this},json(body){token=body.token},status(){throw Error('login failed')}});
  const originalNow=Date.now;
  Date.now=()=>originalNow()+SESSION_MS+1;
  const req={get:()=>`Bearer ${token}`};
  let status;
  auth.attach(req,{status(s){status=s;return this},json(){}},()=>assert.fail('expired session passed'));
  Date.now=originalNow;
  assert.equal(status,401);
  await createAdminAuth('').login({body:{password}}, {set(){return this},status(s){status=s;return this},json(){}});
  assert.equal(status,503);
});
test('public ping and CORS remain available', async () => {
  assert.equal((await request('/api/ping')).status,200);
  const res=await fetch(base+'/api/jobs',{method:'OPTIONS',headers:{Origin:'https://www.tutor49.in','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(res.status,204);
  assert.match(res.headers.get('access-control-allow-headers'),/authorization/);
});
test('unsigned unlock and invalid order fail before database access; registration rejects forged payment', async () => {
  assert.equal((await request('/api/unlocks','POST',{jobId:'000000000000000000000001',tutorPhone:'9999999999',transactionId:'pay_fake'})).status,400);
  assert.equal((await request('/api/payment/create-order','POST',{})).status,400);
  assert.equal((await request('/api/tutors/verify-and-register','POST',{razorpayPaymentId:'pay_fake',razorpayOrderId:'order_fake',razorpaySignature:'fake'})).status,400);
});
test('lead proof checks signature, purpose, lead, phone, captured status, currency, amount and order binding', async () => {
  const secret='local-test-secret', orderId='order_local', transactionId='pay_local';
  const signature=crypto.createHmac('sha256',secret).update(`${orderId}|${transactionId}`).digest('hex');
  const input={jobId:'test-job',tutorPhone:'9999999999',orderId,transactionId,signature};
  const order={amount:4900,currency:'INR',notes:{purpose:'lead_unlock',jobId:input.jobId,tutorPhone:input.tutorPhone}};
  const payment={order_id:orderId,amount:4900,currency:'INR',status:'captured'};
  const gateway=(o=order,p=payment)=>({orders:{fetch:async()=>o},payments:{fetch:async()=>p}});
  assert.equal(validPaymentSignature(orderId,transactionId,signature,secret),true);
  await verifyLeadPayment(gateway(),input,secret);
  for(const bad of [{...input,signature:'0'.repeat(64)},{...input,jobId:'another-job'},{...input,tutorPhone:'8888888888'}]) await assert.rejects(verifyLeadPayment(gateway(),bad,secret));
  for(const bad of [{...payment,status:'authorized'},{...payment,amount:100},{...payment,currency:'USD'},{...payment,order_id:'order_other'}]) await assert.rejects(verifyLeadPayment(gateway(order,bad),input,secret));
  await assert.rejects(verifyLeadPayment(gateway({...order,notes:{...order.notes,purpose:'registration'}}),input,secret));
});
test('public jobs stay masked, old query cannot enable admin reads, parent posts remain pending', async () => {
  const Job=require('../models/jobmodel');
  const find=Job.find, save=Job.prototype.save;
  let filter, saved;
  Job.find=query=>{filter=query;return {sort:async()=>[{parentName:'Private Parent',contactNumber:'9999999999',status:'approved',subject:'Maths',location:'Area'}]}};
  Job.prototype.save=async function(){saved=this;return this};
  try {
    const res=await request('/api/jobs?secret=obsolete-public-bypass');
    assert.equal(res.status,200);
    const body=(await res.json())[0];
    assert.equal(body.contactNumber,'+91 XXXXX XXXXX');
    assert.equal('parentName' in body,false);
    assert.equal(body.subject,'Maths');assert.equal(body.location,'Area');assert.equal(body.status,'approved');
    assert.ok(filter.$or);
    const post=await request('/api/jobs?secret=obsolete-public-bypass','POST',{parentName:'Local test',contactNumber:'9999999999',subject:'Maths',grade:'5',city:'Lucknow',location:'Local test',salary:100,status:'approved',leadType:'classic'});
    assert.equal(post.status,201);
    assert.equal(saved.status,'pending');
    assert.equal(saved.leadType,'direct');
  } finally {Job.find=find;Job.prototype.save=save;}
});
test('admin-injected lead keeps its selected category and approval', async () => {
  const Job=require('../models/jobmodel');
  const original=Job.prototype.save;
  const Tutor=require('../models/tutor');
  const originalFind=Tutor.find;
  Tutor.find=async()=>[];
  const {token}=await (await request('/api/admin/login','POST',{password})).json();
  let saved;
  Job.prototype.save=async function(){saved=this;return this};
  try {
    const res=await request('/api/jobs','POST',{parentName:'Local admin test',contactNumber:'9999999999',subject:'Maths',grade:'5',city:'Lucknow',location:'Local test',salary:100,status:'approved',leadType:'classic'},token);
    assert.equal(res.status,201);
    assert.equal(saved.status,'approved');
    assert.equal(saved.leadType,'classic');
  } finally {Job.prototype.save=original;Tutor.find=originalFind;}
});
test('admin session still receives parentName and unmasked contact, public does not', async () => {
  const Job=require('../models/jobmodel');
  const find=Job.find;
  const {token}=await (await request('/api/admin/login','POST',{password})).json();
  Job.find=()=>({sort:async()=>[{parentName:'Synthetic Parent',contactNumber:'9999999999',status:'pending',subject:'Maths',location:'Area'}]});
  try {
    const admin=await request('/api/jobs','GET',undefined,token);
    assert.equal(admin.status,200);
    const a=(await admin.json())[0];
    assert.equal(a.parentName,'Synthetic Parent');
    assert.equal(a.contactNumber,'9999999999');
    assert.equal(a.status,'pending');
    const pub=await request('/api/jobs');
    const p=(await pub.json())[0];
    assert.equal('parentName' in p,false);
    assert.equal(p.contactNumber,'+91 XXXXX XXXXX');
  } finally {Job.find=find;}
});
test('login is rate limited', async () => {
  let last;
  for(let i=0;i<11;i++)last=await request('/api/admin/login','POST',{password:'wrong'});
  assert.equal(last.status,429);
});
