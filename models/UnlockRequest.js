const mongoose = require('mongoose');

const unlockRequestSchema = new mongoose.Schema({
  jobId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Job', 
    required: true 
  },
  tutorPhone: { 
    type: String, 
    required: true 
  },
  transactionId: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Pending', 'Approved', 'Rejected'], 
    default: 'Pending' 
  },
  // Forward-only: set when an admin approves. Absent on older records = approval time never recorded.
  approvedAt: {
    type: Date
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('UnlockRequest', unlockRequestSchema);