const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateOwnerTestEnvironment,attachOwnerTestRuntime}=require('../tutor-owner-test');
const env={TUTOR_TEST_MONGO_URI:'mongodb://127.0.0.1:27017/tutor49_test',TUTOR_TEST_ORIGIN:'https://www.tutor49.in',TUTOR_TEST_GOOGLE_EMAILS:'owner-fixture@gmail.com',GOOGLE_CLIENT_ID:'fixture'};
test('owner-test config accepts only named DB, approved identity, existing site and TEST keys',()=>{
 const c=validateOwnerTestEnvironment(env);assert.equal(c.config.live,false);assert.equal(c.config.alertsEnabled,false);assert.equal(c.config.cookieNamespace,'t49test');assert.equal(c.config.paymentKey,undefined);
 for(const change of [{TUTOR_TEST_MONGO_URI:'mongodb://127.0.0.1:27017/production'},{TUTOR_TEST_ORIGIN:'https://elsewhere.example'},{TUTOR_TEST_GOOGLE_EMAILS:''},{TUTOR_TEST_GOOGLE_EMAILS:'owner-fixture@gmail.com,other@gmail.com'},{TUTOR_TEST_RAZORPAY_KEY_ID:'rzp_live_fixture',TUTOR_TEST_RAZORPAY_KEY_SECRET:'fixture'},{TUTOR_TEST_RAZORPAY_KEY_ID:'rzp_test_fixture'}])assert.throws(()=>validateOwnerTestEnvironment({...env,...change}));
 const config=validateOwnerTestEnvironment({...env,TUTOR_TEST_RAZORPAY_KEY_ID:'rzp_test_fixture',TUTOR_TEST_RAZORPAY_KEY_SECRET:'fixture'}).config;assert.equal(config.paymentKey,'rzp_test_fixture');
});
test('unconfigured owner test does not connect or mount anything',async()=>{let touched=false;assert.equal(await attachOwnerTestRuntime({use(){touched=true}},{env:{},connect(){touched=true}}),null);assert.equal(touched,false)});

test('explicit existing-cluster reuse always overrides selected database on independent connection',async()=>{
 const reuse={...env,TUTOR_OWNER_TEST_ENABLED:'true',TUTOR_TEST_USE_EXISTING_CLUSTER:'true',MONGO_URI:'mongodb+srv://fixture:fixture@fixture.mongodb.net/production_fixture?retryWrites=true'};
 const c=validateOwnerTestEnvironment(reuse);assert.equal(c.dbName,'tutor49_test');assert.match(c.uri,/production_fixture/);
 let options;await assert.rejects(()=>attachOwnerTestRuntime({use(){}},{env:reuse,connect:async(_uri,received)=>{options=received;throw Error('read-only fixture refusal')}}),/fixture refusal/);assert.equal(options.dbName,'tutor49_test');assert.equal(options.maxPoolSize,3);
 assert.throws(()=>validateOwnerTestEnvironment({...reuse,MONGO_URI:'mongodb://localhost/production_fixture'}));
});
