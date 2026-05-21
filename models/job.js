const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    displayId: { type: String },
    parentName: { type: String, required: true },
    subject: { type: String, required: true },
    grade: { type: String, required: true },
    location: { type: String, required: true }, // e.g., "Aliganj, Lucknow" or "Online"
    salary: { type: String, required: true },
    contactNumber: { type: String, required: true },
    requirements: { type: String }, // This acts as your "Parent Notes"
    
    // ==========================================
    // --- NEW: THE TWO-TIER SYSTEM FIELDS ---
    // ==========================================
    leadType: { 
        type: String, 
        enum: ['premium', 'classic'], 
        default: 'premium' // Magic Switch: Web forms default to 0% commission!
    },
    price: { 
        type: Number, 
        default: 49 // Locks in your universal flat unlock fee
    },
    // ==========================================

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Job', JobSchema);