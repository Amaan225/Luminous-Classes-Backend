const crypto = require('node:crypto');

function validPaymentSignature(orderId, paymentId, signature, secret) {
  if (![orderId, paymentId, signature, secret].every(v => typeof v === 'string' && v)) return false;
  if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

async function verifyLeadPayment(razorpay, { jobId, tutorPhone, transactionId, orderId, signature }, secret) {
  if (!validPaymentSignature(orderId, transactionId, signature, secret)) throw new Error('Invalid payment proof.');
  const [order, payment] = await Promise.all([razorpay.orders.fetch(orderId), razorpay.payments.fetch(transactionId)]);
  if (order.notes?.purpose !== 'lead_unlock' || order.notes?.jobId !== jobId || order.notes?.tutorPhone !== tutorPhone ||
      order.amount !== 4900 || order.currency !== 'INR' || payment.order_id !== orderId ||
      payment.amount !== 4900 || payment.currency !== 'INR') {
    throw new Error('Payment not confirmed for this lead. Contact support if charged.');
  }
  if (payment.status !== 'captured') {
    const error = new Error('Payment capture is pending.');
    error.status = payment.status === 'authorized' ? 409 : 400;
    throw error;
  }
}
module.exports = { validPaymentSignature, verifyLeadPayment };
