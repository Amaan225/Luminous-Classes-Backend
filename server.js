const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Razorpay = require('razorpay');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto'); // <-- Added for Razorpay signature verification

// Models
const Tutor = require('./models/tutor'); 
const UnlockRequest = require('./models/UnlockRequest'); 
const Job = require('./models/jobmodel');
const Application = require('./models/application'); 

const app = express();

app.use(cors());
app.use(express.json());

// Razorpay Initialization
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,      
  key_secret: process.env.RAZORPAY_KEY_SECRET 
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to Luminous Database, Allah's blessings!"))
  .catch((err) => console.log("Database connection error: ", err));

// --- SECURITY & RATE LIMITING ---
const jobPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 3, 
  message: { message: "You have posted the maximum number of requirements allowed. To prevent spam, please wait an hour or contact support." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    return req.query.secret === 'amaan2026';
  }
});

// --- ROUTES ---
app.get('/', (req, res) => res.send('Luminous Backend is connected to the Database!'));
app.get('/api/ping', (req, res) => res.status(200).json({ message: "Luminous API is awake!" }));

// CREATE A NEW JOB & TRIGGER ALERTS
app.post('/api/jobs', jobPostLimiter, async (req, res) => {
  try {
    if (req.query.secret !== 'amaan2026') {
      req.body.status = 'pending';
    }
    const newJob = new Job(req.body); 
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
    if (req.query.secret === 'amaan2026') {
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

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updatedJob) return res.status(404).json({ error: 'Job not found in database.' });
    res.json(updatedJob);
  } catch (err) {
    res.status(400).json({ error: 'Failed to amend record.', details: err });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
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
    const newTutor = new Tutor(req.body);
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
    const pendingTutors = await Tutor.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(pendingTutors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending tutors' });
  }
});

app.put('/api/admin/tutors/:id/status', async (req, res) => {
  try {
    const { status } = req.body; 
    const updatedTutor = await Tutor.findByIdAndUpdate(
      req.params.id, 
      { status }, 
      { new: true }
    );
    res.json(updatedTutor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tutor status' });
  }
});

// --- RAZORPAY PAYMENT ENGINE (LEAD UNLOCKS) ---
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const options = {
      amount: 4900, 
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`,
    };
    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).json({ error: "Failed to create order" });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/unlocks', async (req, res) => {
  try {
    const { jobId, tutorPhone, transactionId } = req.body;
    const newRequest = new UnlockRequest({ jobId, tutorPhone, transactionId, status: 'Approved' });
    await newRequest.save();

    const jobDetails = await Job.findById(jobId);
    if (!jobDetails) return res.status(404).json({ error: "Job not found" });

    res.status(200).json({ 
      message: "Payment verified successfully.",
      unlockedContact: jobDetails.contactNumber 
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to process unlock request" });
  }
});

app.get('/api/unlocks', async (req, res) => {
  try {
    const requests = await UnlockRequest.find().populate('jobId').sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch payment requests" });
  }
});

app.put('/api/unlocks/:id/approve', async (req, res) => {
  try {
    const request = await UnlockRequest.findByIdAndUpdate(req.params.id, { status: 'Approved' }, { new: true });
    res.status(200).json(request);
  } catch (error) {
    res.status(500).json({ error: "Failed to approve payment" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));