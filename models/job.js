const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    displayId: { type: String },
    parentName: { type: String, required: true },
    subject: { type: String, required: true },
    grade: { type: String, required: true },
    location: { type: String, required: true }, // e.g., "Aliganj, Lucknow" or "Online"
    salary: { type: String, required: true },
    contactNumber: { type: String, required: true },
    requirements: { type: String }, // Any extra details
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Job', JobSchema);