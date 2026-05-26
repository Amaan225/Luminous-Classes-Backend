const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  // --- PARENT INPUT DATA ---
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
    // NO enum here, so custom grades typed via "Other" are accepted
  },
  city: { 
    type: String, 
    required: true, 
    trim: true 
    // NO enum here, so custom cities typed via "Other" are accepted
  },
  location: { 
    type: String, 
    required: true, 
    trim: true 
    // NO enum here, so custom areas typed via "Other" are accepted
  },
  salary: { 
    type: Number, 
    required: true,
    min: [0, 'Salary cannot be negative'] // Prevents parents from typing negative budgets
  },
  requirements: { 
    type: String, 
    trim: true 
  },
  
  // --- INTERNAL PLATFORM DATA (Not set by the parent) ---
  leadType: {
    type: String,
    enum: ['premium', 'classic'],
    default: 'premium' // Parent posts are always premium (0% commission)
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending' // Keeps spam off the board until you approve it in the admin panel
  },
  price: { 
    type: Number, 
    default: 49 // Your standard unlock fee
  },
  displayId: { 
    type: String // e.g., 'TK-1024'
  }
}, { 
  timestamps: true // Automatically adds createdAt and updatedAt dates
});

// Pre-save hook to auto-generate the TK-XXXX display ID before saving to database
jobSchema.pre('save', function(next) {
  if (!this.displayId) {
    // Generates a random 4 digit number for the ID
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    this.displayId = `TK-${randomNum}`;
  }
  next();
});

module.exports = mongoose.model('Job', jobSchema);