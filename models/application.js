const mongoose = require('mongoose');

const ApplicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true }, // Links this application to a specific job
  tutorName: { type: String, required: true },
  tutorPhone: { type: String, required: true },
  pitch: { type: String, required: true }, // "Why I'm a good fit"
  appliedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Application', ApplicationSchema);