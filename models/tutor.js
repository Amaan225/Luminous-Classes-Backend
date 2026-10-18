const mongoose = require('mongoose');

const tutorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  collegeId: { type: String, required: true }, // Aadhar / College ID
  city: { type: String, default: 'Lucknow' },
  preferredArea: { type: String, required: true },
  
  // --- NEW PAYMENT FIELDS ---
  paymentId: { type: String },
  orderId: { type: String },
  isPaid: { type: Boolean, default: false },
  status: { type: String, default: 'pending' } // Pending admin verification queue
}, { timestamps: true });

module.exports = mongoose.model('Tutor', tutorSchema);