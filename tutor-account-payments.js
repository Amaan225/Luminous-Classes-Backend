const crypto=require('crypto');
function createPaymentService({models=require('./models/tutor-account'),Tutor=require('./models/tutor-profile'),razorpay}={}){
 const {Order}=models;
 async function settle(o,paymentId){
  const [order,payment]=await Promise.all([razorpay.orders.fetch(o.providerOrderId),razorpay.payments.fetch(paymentId)]);
  const notes=order?.notes;
  if(!order||!payment||order.id!==o.providerOrderId||order.amount!==o.amount||order.currency!==o.currency||notes?.purpose!==`tutor49_${o.kind}_v1`||notes?.accountId!==String(o.accountId)||notes?.tutorId!==String(o.tutorId)||notes?.resource!==o.resource||payment.order_id!==o.providerOrderId||payment.amount!==o.amount||payment.currency!==o.currency)throw Error('Payment mismatch');
  if(payment.status!=='captured')return false;
  if(o.status==='verified'&&o.paymentId!==paymentId)throw Error('Conflicting captured payment');
  await Order.updateOne({_id:o._id,status:{$in:['created','reconcile','verified']},$or:[{paymentId:{$exists:false}},{paymentId}]},{$set:{status:'verified',paymentId,verifiedAt:o.verifiedAt||new Date()}},{runValidators:true});
  const saved=await Order.findById(o._id);
  if(saved.status!=='verified'||saved.paymentId!==paymentId)throw Error('Order needs review');
  // Retry-safe repair if process stopped after saving the verified order but before the profile.
  if(o.kind==='registration')await Tutor.updateOne({_id:o.tutorId},{$set:{isPaid:true,paymentId,orderId:o.providerOrderId}});
  return true;
 }
 async function reconcile(o){
  if(!o.providerOrderId)return {verified:false,needsSupport:true};
  const response=await razorpay.orders.fetchPayments(o.providerOrderId);
  const captured=(response.items||[]).filter(p=>p.status==='captured');
  if(captured.length>1)throw Error('Multiple captures need review');
  if(!captured.length)return {verified:false,pending:(response.items||[]).some(p=>p.status==='authorized')};
  return {verified:await settle(o,captured[0].id)};
 }
 async function recoverOrder(providerOrderId){
  let o=await Order.findOne({providerOrderId,source:'provider'});if(o)return o;
  const order=await razorpay.orders.fetch(providerOrderId);if(!order||!/^t49_[a-f0-9]{24}$/.test(order.receipt||''))return null;
  const candidate=await Order.findOne({_id:order.receipt.slice(4),source:'provider',status:{$in:['creating','reconcile']},providerOrderId:{$exists:false}});if(!candidate)return null;
  const n=order.notes;if(order.amount!==candidate.amount||order.currency!==candidate.currency||n?.purpose!==`tutor49_${candidate.kind}_v1`||n?.accountId!==String(candidate.accountId)||n?.tutorId!==String(candidate.tutorId)||n?.resource!==candidate.resource)throw Error('Order mismatch');
  await Order.updateOne({_id:candidate._id,providerOrderId:{$exists:false}},{$set:{providerOrderId,status:'reconcile'}});
  o=await Order.findOne({_id:candidate._id,providerOrderId});if(!o)throw Error('Conflicting provider order');return o;
 }
 return {settle,reconcile,recoverOrder};
}
function createPaymentWebhook({models=require('./models/tutor-account'),Tutor,razorpay,secret=process.env.TUTOR_RAZORPAY_WEBHOOK_SECRET}={}){
 const express=require('express'),r=express.Router();const service=createPaymentService({models,Tutor,razorpay});
 r.post('/',express.raw({type:'application/json',limit:'100kb'}),async(req,res)=>{
  if(!secret||!razorpay||!Buffer.isBuffer(req.body))return res.status(503).json({error:'Webhook not configured'});
  const signature=req.get('X-Razorpay-Signature')||'';
  const expected=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).end();
  let event;try{event=JSON.parse(req.body.toString('utf8'))}catch{return res.status(400).end()}
  if(!['payment.captured','order.paid'].includes(event.event))return res.status(204).end();
  const entity=event.payload?.payment?.entity;
  if(!entity?.id||!entity.order_id)return res.status(400).end();
  try{const o=await service.recoverOrder(entity.order_id);if(o)await service.settle(o,entity.id);return res.status(204).end()}
  catch{return res.status(503).json({error:'Confirmation pending; retry event'})}
 });return r;
}
module.exports={createPaymentService,createPaymentWebhook};
