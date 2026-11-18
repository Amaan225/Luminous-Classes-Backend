const mongoose = require('mongoose');
const Legacy = require('./tutor');

// Profiles created through Google tutor accounts live in their own collection, so
// identity rules of the original /register records are untouched and old records
// never block, merge into, or grant rights to a new account.
const profileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  collegeId: { type: String, required: true },
  city: { type: String, default: 'Lucknow' },
  preferredArea: { type: String, required: true },
  paymentId: { type: String },
  orderId: { type: String },
  isPaid: { type: Boolean, default: false },
  status: { type: String, default: 'pending' }
}, { timestamps: true });

const Profile = mongoose.models.TutorAccountProfile || mongoose.model('TutorAccountProfile', profileSchema, 'tutor_account_profiles');

// Only admin-reviewed links (tutorId pointing at an original registration) fall back to the old collection.
if (!Profile.__legacyFallback) {
  const findById = Profile.findById.bind(Profile);
  const updateOne = Profile.updateOne.bind(Profile);
  Profile.findById = (id, ...rest) => findById(id, ...rest).then(p => p || Legacy.findById(id));
  Profile.updateOne = async (filter, ...rest) => {
    const r = await updateOne(filter, ...rest);
    return r.matchedCount ? r : Legacy.updateOne(filter, ...rest);
  };
  Profile.__legacyFallback = true;
}
module.exports = Profile;
