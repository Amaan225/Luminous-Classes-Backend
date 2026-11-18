// Additive test runtime on the existing service. No production-model queries,
// live-key fallback, alert transport or public account activation.
const mongoose=require('mongoose');
const express=require('express');
function validateOwnerTestEnvironment(env){
 const reuse=env.TUTOR_TEST_USE_EXISTING_CLUSTER==='true';
 let uri,origin;try{uri=new URL(reuse?env.MONGO_URI:env.TUTOR_TEST_MONGO_URI);origin=new URL(env.TUTOR_TEST_ORIGIN)}catch{throw Error('Named test DB and existing HTTPS origin required')}
 if(!['mongodb:','mongodb+srv:'].includes(uri.protocol)||(!reuse&&uri.pathname!=='/tutor49_test'))throw Error('Only tutor49_test database is allowed');
 // Reuse only the existing cluster credential, never its selected database.
 // dbName below forces a separate connection into tutor49_test.
 if(reuse&&(!uri.hostname.endsWith('.mongodb.net')||uri.protocol!=='mongodb+srv:'))throw Error('Existing Atlas cluster required');
 if(origin.origin!=='https://www.tutor49.in'||origin.href!=='https://www.tutor49.in/')throw Error('Only existing canonical site origin allowed');
 const emails=String(env.TUTOR_TEST_GOOGLE_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if(emails.length!==1||!/^([^@\s]+)@gmail\.com$/.test(emails[0])||!env.GOOGLE_CLIENT_ID)throw Error('Approved owner test Gmail and client required');
 const paymentKey=env.TUTOR_TEST_RAZORPAY_KEY_ID,paymentSecret=env.TUTOR_TEST_RAZORPAY_KEY_SECRET;
 if(Boolean(paymentKey)!==Boolean(paymentSecret)||(paymentKey&&!paymentKey.startsWith('rzp_test_')))throw Error('Matching TEST-only payment keys required');
 return {uri:uri.href,dbName:'tutor49_test',config:{enabled:true,live:false,secure:true,cookieNamespace:'t49test',googleClientId:env.GOOGLE_CLIENT_ID,origins:[origin.origin],previewEmails:emails,pendingPolicy:'masked',retentionPolicy:'retain-purchased',alertsEnabled:false,paymentKey,paymentSecret}};
}
async function attachOwnerTestRuntime(app,{env=process.env,connect=(uri,options)=>mongoose.createConnection(uri,options).asPromise()}={}){
 if(env.TUTOR_OWNER_TEST_ENABLED!=='true')return null;
 const {uri,dbName,config}=validateOwnerTestEnvironment(env);
 const connection=await connect(uri,{dbName,maxPoolSize:3,serverSelectionTimeoutMS:15000});
 try{
  const scoped=require('./tutor-test-models').createTutorTestModels(connection);
  await Promise.all([...Object.values(scoped.models),...Object.values(scoped.alertModels),scoped.Tutor,scoped.Job,scoped.Unlock].map(model=>model.init()));
  const razorpay=config.paymentKey?new (require('razorpay'))({key_id:config.paymentKey,key_secret:config.paymentSecret}):undefined;
  // Entire router precedes global JSON parser so a signed webhook sees raw bytes.
  const router=express.Router();router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});next()});
  if(razorpay&&env.TUTOR_TEST_WEBHOOK_SECRET)router.use('/payment-webhook',require('./tutor-account-payments').createPaymentWebhook({...scoped,razorpay,secret:env.TUTOR_TEST_WEBHOOK_SECRET}));
  router.use(express.json({limit:'100kb'}));router.use(require('./tutor-account-routes').createTutorAccountRouter({...scoped,razorpay,config}));
  app.use('/api/tutor-test',router);
  return {close:()=>connection.close(),connection};
 }catch(error){await connection.close();throw error}
}
module.exports={validateOwnerTestEnvironment,attachOwnerTestRuntime};
