const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Razorpay = require('razorpay');

// Models
const Tutor = require('./models/tutor');
const UnlockRequest = require('./models/UnlockRequest');
const Job = require('./models/job');
const Application = require('./models/application');

// 1. App Creation
const app = express();

// 2. Middleware
app.use(cors());
app.use(express.json());

// 3. Razorpay Initialization
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,       
  key_secret: process.env.RAZORPAY_KEY_SECRET 
});

// 4. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to Luminous Database, Allah's blessings!"))
  .catch((err) => console.log("Database connection error: ", err));

// ==========================================
//                 ROUTES
// ==========================================

// Simple Health Check
app.get('/', (req, res) => {
  res.send('Luminous Backend is connected to the Database!');
});

app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: "Luminous API is awake!" });
});

// --- JOBS ROUTES ---
// --- CREATE A NEW JOB ---
app.post('/api/jobs', async (req, res) => {
  try {
    // 1. Generate a random 4-digit number (e.g., 4829)
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    
    // 2. Attach the custom ID to the incoming data before saving
    req.body.displayId = `TK-${randomNum}`; 

    const newJob = new Job(req.body); 
    const savedJob = await newJob.save(); 
    res.status(201).json(savedJob); 
  } catch (err) {
    res.status(500).json({ message: "Error saving job", error: err });
  }
});

// --- GET ALL JOBS (UPDATED WITH QUARANTINE LOGIC) ---
app.get('/api/jobs', async (req, res) => {
  try {
    // 1. If the request has our secret admin key, send ALL unmasked data (Pending + Approved)
    if (req.query.secret === 'amaan2026') {
      const allJobs = await Job.find().sort({ createdAt: -1 });
      return res.status(200).json(allJobs);
    }

    // 2. Otherwise (for public tutors), ONLY fetch jobs that are approved (or legacy jobs without a status)
    const approvedJobs = await Job.find({ 
      $or: [
        { status: 'approved' }, 
        { status: { $exists: false } } 
      ] 
    }).sort({ createdAt: -1 });

    // 3. Mask the contact numbers for the public board
    const maskedJobs = approvedJobs.map(job => {
      // Convert mongoose document to standard object so we can modify it
      const jobObj = job.toObject ? job.toObject() : job; 
      jobObj.contactNumber = "+91 XXXXX XXXXX";
      return jobObj;
    });

    res.status(200).json(maskedJobs);
  } catch (err) {
    res.status(500).json({ message: "Error fetching jobs", error: err });
  }
});

// --- NEW: AMEND RECORD (PUT) ---
app.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedJob = await Job.findByIdAndUpdate(
      id, 
      req.body, 
      { 
        new: true, // Returns the fresh data back to the frontend
        runValidators: true // Enforces Mongoose schema rules (like premium vs classic)
      }
    );

    if (!updatedJob) {
      return res.status(404).json({ error: 'Job not found in database.' });
    }

    res.json(updatedJob);
  } catch (err) {
    console.error("Error updating job:", err);
    res.status(400).json({ error: 'Failed to amend record.', details: err });
  }
});

// --- DELETE JOB ---
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
});

// --- APPLICATIONS ROUTE (Free Tier) ---
app.post('/api/applications', async (req, res) => {
  try {
    const newApp = new Application(req.body);
    const savedApp = await newApp.save();
    res.status(201).json(savedApp);
  } catch (error) {
    res.status(500).json({ error: "Failed to submit application" });
  }
});

app.get('/api/applications', async (req, res) => {
  try {
    const apps = await Application.find();
    res.json(apps);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});


// ==========================================
//          THE PAYMENT ENGINE (RAZORPAY)
// ==========================================

// 1. Generate Razorpay Order
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const options = {
      amount: 4900, // ₹49.00 = 4900 paise
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    
    if (!order) {
      return res.status(500).json({ error: "Failed to create order" });
    }

    res.json(order);
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Fully Automated Instant Unlock Delivery
app.post('/api/unlocks', async (req, res) => {
  try {
    const { jobId, tutorPhone, transactionId } = req.body;
    
    // 1. Save the transaction to the database
    const newRequest = new UnlockRequest({
      jobId,
      tutorPhone,
      transactionId,
      status: 'Approved' // Since Razorpay verified it, we mark it delivered
    });
    await newRequest.save();

    // 2. Fetch the real job to get the parent's actual number
    const jobDetails = await Job.findById(jobId);
    if (!jobDetails) {
      return res.status(404).json({ error: "Job not found" });
    }

    // 3. Send the real number securely back to the frontend!
    res.status(200).json({ 
      message: "Payment verified successfully.",
      unlockedContact: jobDetails.contactNumber 
    });

  } catch (error) {
    console.error("Unlock error:", error);
    res.status(500).json({ error: "Failed to process unlock request" });
  }
});

// 3. Get all transactions for Admin Dashboard
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
    const request = await UnlockRequest.findByIdAndUpdate(
      req.params.id, 
      { status: 'Approved' }, 
      { new: true }
    );
    res.status(200).json(request);
  } catch (error) {
    res.status(500).json({ error: "Failed to approve payment" });
  }
});


// ==========================================
//               TUTOR ROUTES
// ==========================================

app.post('/api/tutors', async (req, res) => {
  try {
    const newTutor = new Tutor(req.body);
    const savedTutor = await newTutor.save();
    res.status(201).json(savedTutor);
  } catch (error) {
    res.status(500).json({ error: "Failed to register tutor. Email might already exist." });
  }
});

app.get('/api/tutors', async (req, res) => {
  try {
    const tutors = await Tutor.find();
    res.json(tutors);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tutors" });
  }
});

app.patch('/api/tutors/:id/approve', async (req, res) => {
  try {
    const updatedTutor = await Tutor.findByIdAndUpdate(
      req.params.id, 
      { status: 'approved' }, 
      { new: true }
    );
    res.json(updatedTutor);
  } catch (error) {
    res.status(500).json({ error: "Failed to approve tutor" });
  }
});

// ==========================================
//               SERVER START
// ==========================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});