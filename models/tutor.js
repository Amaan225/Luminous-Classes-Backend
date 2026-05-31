const mongoose = require('mongoose');

const TutorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true }, 
  phone: { type: String, required: true },
  collegeId: { type: String, required: true }, 
  
  // --- NEW LEVEL-UP FIELDS ---
  city: { type: String, required: true },
  preferredArea: { type: String, required: true },
  
  status: { type: String, default: 'pending' }, 
  registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tutor', TutorSchema);