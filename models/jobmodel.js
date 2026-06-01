const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  // --- PARENT INPUT DATA ---
  
  title: { 
    type: String, 
    trim: true 
  },
  parentName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  contactNumber: { 
    type: String, 
    required: true,
    // Regex ensures it is EXACTLY 10 digits, keeping your Razorpay flow safe
    match: [/^\d{10}$/, 'Contact number must be exactly 10 digits'] 
  },
  subject: { 
    type: String, 
    required: true, 
    trim: true 
  },
  grade: { 
    type: String, 
    required: true, 
    trim: true 
  },
  city: { 
    type: String, 
    required: true, 
    trim: true 
  },
  location: { 
    type: String, 
    required: true, 
    trim: true 
  },
  salary: { 
    type: Number, 
    required: true,
    min: [0, 'Salary cannot be negative']
  },
  requirements: { 
    type: String, 
    trim: true 
  },
  
  // --- INTERNAL PLATFORM DATA ---
  leadType: {
    type: String,
    // THE FIX: 'direct' added as an option and set as the new default. 
    // 'premium' is kept strictly for backward compatibility with old data.
    enum: ['direct', 'premium', 'classic'],
    default: 'direct'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  price: { 
    type: Number, 
    default: 49 
  },
  displayId: { 
    type: String,
    // --- Auto-generates the ID instantly upon creation ---
    default: function() {
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `TK-${randomNum}`;
    }
  }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('Job', jobSchema);