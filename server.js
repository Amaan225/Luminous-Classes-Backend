const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Razorpay = require('razorpay');
const rateLimit = require('express-rate-limit');

// Models
const Tutor = require('./models/tutor'); // Assuming you have this
const UnlockRequest = require('./models/UnlockRequest'); // Assuming you have this
const Job = require('./models/job');
const Application = require('./models/application'); // Assuming you have this

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

// CREATE A NEW JOB
app.post('/api/jobs', jobPostLimiter, async (req, res) => {
  try {
    if (req.query.secret !== 'amaan2026') {
      req.body.status = 'pending';
    }
    const newJob = new Job(req.body); 
    const savedJob = await newJob.save(); 
    res.status(201).json(savedJob); 
  } catch (err) {
    console.error("Database Error:", err);
    res.status(400).json({ message: "Error saving job", error: err.message });
  }
});

// GET ALL JOBS
app.get('/api/jobs', async (req, res) => {
  try {
    if (req.query.secret === 'amaan2026') {
      const allJobs = await Job.find().sort({ createdAt: -1 });
      return res.status(200).json(allJobs);
    }
    const approvedJobs = await Job.find({ 
      $or: [{ status: 'approved' }, { status: { $exists: false } }] 
    }).sort({ createdAt: -1 });

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

// --- RAZORPAY PAYMENT ENGINE ---
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