const mongoose = require('mongoose');

const TutorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true }, // Your new email requirement!
  phone: { type: String, required: true },
  collegeId: { type: String, required: true }, 
  status: { type: String, default: 'pending' }, // This keeps them in the waiting room
  registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tutor', TutorSchema);