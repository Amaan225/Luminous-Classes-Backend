const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Razorpay = require('razorpay');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto'); // <-- Added for Razorpay signature verification

// Models
const Tutor = require('./models/tutor');
const TutorProfile = require('./models/tutor-profile');
const UnlockRequest = require('./models/UnlockRequest');
const Job = require('./models/jobmodel');
const Application = require('./models/application');
const { verifyLeadPayment } = require('./payment-verification');

const { createAdminAuth } = require('./admin-auth');
const app = express();
app.set('trust proxy', 1);

app.use(cors());
// Signed webhook needs exact raw bytes before the JSON body parser.
if(process.env.TUTOR_ACCOUNTS_ENABLED==='true'){
 const webhookRazorpay=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
 if(process.env.TUTOR_ACCOUNTS_LIVE==='true'||String(process.env.RAZORPAY_KEY_ID).startsWith('rzp_test_'))app.use('/api/tutor-account-payment-webhook',require('./tutor-account-payments').createPaymentWebhook({razorpay:webhookRazorpay}));
}
// Owner-only test router stays separate from public account flags and the
// production connection. Mount before JSON parsing for raw signed TEST webhooks.
if(process.env.TUTOR_OWNER_TEST_ENABLED==='true'){
 const ownerTest=express.Router();let ownerReady=false;
 app.use('/api/tutor-test',(req,res,next)=>ownerReady?next():res.status(503).json({error:'Owner test is starting. Retry shortly.'}));
 app.use(ownerTest);
 if(require.main===module)require('./tutor-owner-test').attachOwnerTestRuntime(ownerTest)
  .then(runtime=>{ownerReady=Boolean(runtime);process.once('SIGTERM',()=>runtime?.close());process.once('SIGINT',()=>runtime?.close())})
  .catch(()=>console.error('Owner test connection unavailable; public service unchanged.'));
}
app.use(express.json({ limit: '100kb' }));
const adminAuth = createAdminAuth();
app.use(adminAuth.attach);
app.post('/api/admin/login', adminAuth.loginLimiter, adminAuth.login);
app.post('/api/admin/logout', adminAuth.requireAdmin, adminAuth.logout);
app.use('/api/admin', adminAuth.requireAdmin);
app.get('/api/admin/session', (req, res) => res.json({ expiresAt: req.adminSession.expiry }));

// Razorpay Initialization
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Phase 1 stays off until separately configured and reviewed. No legacy route changes in preview.
if (process.env.TUTOR_ACCOUNTS_ENABLED === 'true') {
  if (process.env.TUTOR_ACCOUNTS_LIVE !== 'true') {
    let previewDatabase = '';
    try { previewDatabase = new URL(process.env.MONGO_URI).pathname.slice(1); } catch { /* fail closed below */ }
    if (!['tutor49_preview', 'tutor49_test'].includes(previewDatabase)) throw new Error('Preview must use a separate named test database.');
  }
  const { createTutorAccountRouter } = require('./tutor-account-routes');
  const { createTutorAccountAdminRouter } = require('./tutor-account-admin');
  app.use('/api/tutor-account', createTutorAccountRouter({ razorpay, config: { issueAdminSession: adminAuth.issue } }));
  const {createAlertDrainRouter,configuredAlertService}=require('./tutor-alert-drain');
  app.use('/api/internal/tutor-alert-drain',createAlertDrainRouter({service:configuredAlertService()}));
  app.use('/api/admin/tutor-accounts', createTutorAccountAdminRouter());
}
app.use((req, res, next) => {
  if (process.env.TUTOR_LEGACY_CHECKOUT_DISABLED === 'true' && process.env.TUTOR_ACCOUNTS_LIVE === 'true' && req.method === 'POST' &&
      ['/api/tutors', '/api/create-registration-order', '/api/tutors/verify-and-register', '/api/payment/create-order', '/api/unlocks'].includes(req.path)) {
    return res.status(410).json({ error: 'Use your signed-in tutor account. Legacy purchases need support recovery, not another payment.' });
  }
  next();
});

if (require.main === module) mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to Luminous Database, Allah's blessings!"))
  .catch((err) => console.log("Database connection error: ", err));

// --- SECURITY & RATE LIMITING ---
const jobPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { message: "You have posted the maximum number of requirements allowed. To prevent spam, please wait an hour or contact support." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => Boolean(req.adminSession)
});

// --- ROUTES ---
app.get('/', (req, res) => res.send('Luminous Backend is connected to the Database!'));
app.get('/api/ping', (req, res) => res.status(200).json({ message: "Luminous API is awake!" }));
app.get('/api/version', (req, res) => res.status(200).json({ commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'unknown' }));

// CREATE A NEW JOB & TRIGGER ALERTS
app.post('/api/jobs', jobPostLimiter, async (req, res) => {
  try {
    if (!req.adminSession) {
      req.body.status = 'pending';
      // Parent-posted requirements are Direct; admin-injected categories stay explicit.
      req.body.leadType = 'direct';
    }
    delete req.body.contactSuppressedAt;delete req.body.alertFirstApprovedAt;delete req.body.alertEnqueuedAt;
    const newJob = new Job(req.body);
    if(process.env.TUTOR_ALERTS_ENABLED==='true'&&newJob.status==='approved')newJob.alertFirstApprovedAt=new Date();
    const savedJob = await newJob.save();

    // ==========================================
    // THE HYPER-LOCAL ALERT ENGINE
    // ==========================================
    if (savedJob.status === 'approved') {
      const matchingTutors = await Tutor.find({
        status: 'approved',
        city: { $regex: new RegExp(`^${savedJob.city}$`, 'i') },
        preferredArea: { $regex: new RegExp(`^${savedJob.location}$`, 'i') }
      });

      console.log(`Alert Engine: Found ${matchingTutors.length} tutors in ${savedJob.location}.`);

      matchingTutors.forEach(tutor => {
        const message = `🚨 *Tutor49 Alert!* 🚨\nA new ₹${savedJob.salary} tuition requirement was just posted in your area: *${savedJob.location}*.\n\nSubject: ${savedJob.subject}\n\nLog in now to unlock it before it's gone!`;
        console.log(`Sending WhatsApp to ${tutor.name} (${tutor.phone}): \n${message}`);
      });
    }

    res.status(201).json(savedJob);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(400).json({ message: "Error saving job", error: err.message });
  }
});

// GET ALL JOBS (SORTED HIGHEST TO LOWEST SALARY)
app.get('/api/jobs', async (req, res) => {
  try {
    // If Admin panel requests it, sort by highest salary as well
    if (req.adminSession) {
      res.set('Cache-Control', 'no-store');
      const allJobs = await Job.find().sort({ salary: -1 });
      return res.status(200).json(allJobs);
    }

    // Public view: Fetch approved jobs and sort by salary descending (-1)
    const approvedJobs = await Job.find({
      $or: [{ status: 'approved' }, { status: {$exists: false } }]
    }).sort({ salary: -1 });

    const maskedJobs = approvedJobs.map(job => {
      const jobObj = job.toObject ? job.toObject() : job;
      jobObj.contactNumber = "+91 XXXXX XXXXX";
      return jobObj;
    });
    res.status(200).json(maskedJobs);
  } catch (err) {
    res.status(500).json({ message: "Error fetching jobs", error: err });
  }
});

app.put('/api/jobs/:id', adminAuth.requireAdmin, async (req, res) => {
  try {
    const updatedJob = await require('./job-update').updateJob(Job,req.params.id,req.body,{alertsEnabled:process.env.TUTOR_ALERTS_ENABLED==='true'});
    if (!updatedJob) return res.status(404).json({ error: 'Job not found in database.' });
    res.json(updatedJob);
  } catch (err) {
    res.status(400).json({ error: 'Failed to amend record.', details: err });
  }
});

app.delete('/api/jobs/:id', adminAuth.requireAdmin, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
});

// ==========================================
// TUTOR REGISTRATION & PAYMENT ROUTES
// ==========================================

// 1. Standard Fallback Registration (Unpaid / Legacy)
app.post('/api/tutors', async (req, res) => {
  try {
    const newTutor = new Tutor({ ...req.body, status: 'pending', isPaid: false, paymentId: undefined, orderId: undefined });
    await newTutor.save();
    res.status(201).json({ message: 'Tutor registered successfully!' });
  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'This email or phone is already registered.' });
    }
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// 2. CREATE REGISTRATION ORDER (₹49)
app.post('/api/create-registration-order', async (req, res) => {
  try {
    const options = {
      amount: 49 * 100, // Amount in paise (49 INR = 4900 paise)
      currency: "INR",
      receipt: `reg_receipt_${Date.now()}`,
    };
    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).json({ error: "Failed to create registration order" });
    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Razorpay registration order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. VERIFY PAYMENT & REGISTER TUTOR (₹49 Flow)
app.post('/api/tutors/verify-and-register', async (req, res) => {
  try {
    const {
      name, email, phone, collegeId, city, preferredArea,
      razorpayPaymentId, razorpayOrderId, razorpaySignature
    } = req.body;

    // Verify Signature for Security
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature! Security verification failed.' });
    }

    // Save Paid Tutor to MongoDB
    const newTutor = new Tutor({
      name,
      email,
      phone,
      collegeId,
      city,
      preferredArea,
      paymentId: razorpayPaymentId,
      orderId: razorpayOrderId,
      isPaid: true,
      status: 'pending' // Goes to Admin Pending Tutors Queue
    });

    await newTutor.save();
    res.status(201).json({ success: true, message: 'Tutor registered and payment verified successfully!' });

  } catch (error) {
    console.error('Tutor registration verification error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, error: 'This email or phone is already registered.' });
    }
    res.status(500).json({ success: false, error: 'Server error during verification', details: error.message });
  }
});

app.get('/api/admin/tutors/pending', async (req, res) => {
  try {
    const [legacyPending, accountPending] = await Promise.all([
      Tutor.find({ status: 'pending' }),
      process.env.TUTOR_ACCOUNTS_ENABLED === 'true' ? TutorProfile.find({ status: 'pending', isPaid: true }) : []
    ]);
    const pendingTutors = [...legacyPending.map(t => ({ ...t.toObject(), source: 'legacy-registration' })), ...accountPending.map(t => ({ ...t.toObject(), source: 'google-account' }))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(pendingTutors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending tutors' });
  }
});

app.put('/api/admin/tutors/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid tutor status.' });
    let updatedTutor = await Tutor.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updatedTutor) {
      updatedTutor = await TutorProfile.findOneAndUpdate({ _id: req.params.id }, { status }, { new: true });
    }
    res.json(updatedTutor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tutor status' });
  }
});

// --- RAZORPAY PAYMENT ENGINE (LEAD UNLOCKS) ---
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const { jobId, tutorPhone } = req.body;
    if (typeof jobId !== 'string' || !mongoose.isObjectIdOrHexString(jobId) || typeof tutorPhone !== 'string' || !/^\d{10}$/.test(tutorPhone)) {
      return res.status(400).json({ error: 'Select a lead and enter a valid phone number.' });
    }
    const job = await Job.findById(jobId);
    if (!job || !['approved', undefined].includes(job.status)) return res.status(404).json({ error: 'Lead unavailable.' });
    const options = {
      amount: 4900,
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`,
      notes: { purpose: 'lead_unlock', jobId, tutorPhone },
    };
    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).json({ error: "Failed to create order" });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/unlocks', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { jobId, tutorPhone, transactionId, orderId, signature } = req.body;
    if (typeof jobId !== 'string' || !mongoose.isObjectIdOrHexString(jobId) || typeof tutorPhone !== 'string' || !/^\d{10}$/.test(tutorPhone)) {
      return res.status(400).json({ error: 'Invalid unlock request.' });
    }
    // Verify before any database write or private-contact lookup.
    await verifyLeadPayment(razorpay, { jobId, tutorPhone, transactionId, orderId, signature }, process.env.RAZORPAY_KEY_SECRET);
    const jobDetails = await Job.findById(jobId);
    if (!jobDetails || !['approved', undefined].includes(jobDetails.status)) return res.status(404).json({ error: 'Lead unavailable. Contact support if charged.' });
    // Order notes bind this payment to exactly this lead and phone, so replay
    // cannot unlock another lead. Retries for the same purchase are idempotent.
    await UnlockRequest.findOneAndUpdate(
      { transactionId, jobId, tutorPhone },
      { $setOnInsert: { jobId, tutorPhone, transactionId, status: 'Approved' } },
      { upsert: true, new: true, runValidators: true }
    );
    return res.status(200).json({ message: 'Payment verified successfully.', unlockedContact: jobDetails.contactNumber });
  } catch (error) {
    return res.status(error.status === 409 ? 409 : 400).json({ error: error.status === 409 ? 'Payment confirmation pending. Please wait.' : 'Payment verification failed. Contact support if charged.' });
  }
});

app.get('/api/unlocks', adminAuth.requireAdmin, async (req, res) => {
  try {
    const requests = await UnlockRequest.find().populate('jobId').sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch payment requests" });
  }
});

app.put('/api/unlocks/:id/approve', adminAuth.requireAdmin, async (req, res) => {
  try {
    const request = await UnlockRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Unlock request not found.' });
    if (request.status !== 'Approved') {
      request.status = 'Approved';
      request.approvedAt = new Date();
      await request.save();
    }
    res.status(200).json(request);
  } catch (error) {
    res.status(500).json({ error: "Failed to approve payment" });
  }
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
 app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
 const service=require('./tutor-alert-drain').configuredAlertService();
 const stopAlerts=require('./tutor-alert-loop').startAlertLoop({service,enabled:process.env.TUTOR_ALERTS_LIVE==='true',onError:message=>console.error(message)});
 process.once('SIGTERM',stopAlerts);process.once('SIGINT',stopAlerts);
}
module.exports = app;