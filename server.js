const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Tutor = require('./models/tutor');
const UnlockRequest = require('./models/UnlockRequest');

const Job = require('./models/job');
const Application = require('./models/application');
require('dotenv').config();

console.log("My DB Link is: ", process.env.MONGO_URI); // Add this temporarily
const app = express();

app.use(cors());
app.use(express.json()); // This allows your server to understand JSON data

// 1. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to Luminous Database, Allah's blessings!"))
    .catch((err) => console.log("Database connection error: ", err));

// 2. Simple Route
app.get('/', (req, res) => {
    res.send('Luminous Backend is connected to the Database!');
});

// A simple health check route for the cron job to ping
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: "Luminous API is awake!" });
});

// Route to create a new Tuition Job
app.post('/api/jobs', async (req, res) => {
    try {
        const newJob = new Job(req.body); // Get the data from the request body
        const savedJob = await newJob.save(); // Save it to MongoDB
        res.status(201).json(savedJob); // Send back the saved job as confirmation
    } catch (err) {
        res.status(500).json({ message: "Error saving job", error: err });
    }
});

// POST a new application
app.post('/api/applications', async (req, res) => {
  try {
    const newApp = new Application(req.body);
    const savedApp = await newApp.save();
    res.status(201).json(savedApp);
  } catch (error) {
    res.status(500).json({ error: "Failed to submit application" });
  }
});


// Route to get all Tuition Jobs (for the Teachers to see)
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 });
    
    // The Masking Pipeline: Hide the contact numbers
    const securedJobs = jobs.map(job => {
      const jobData = job.toObject();
      jobData.contactNumber = "+91 XXXXX XXXXX"; // The vault is locked!
      return jobData;
    });

    res.status(200).json(securedJobs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// ----------------------------------------------------
// GET all applications (For the Admin)
app.get('/api/applications', async (req, res) => {
  try {
    const apps = await Application.find();
    res.json(apps);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// DELETE a job (For the Admin when a tutor is hired)
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
});

// --- UNLOCK PAYMENT ROUTE ---
app.post('/api/unlocks', async (req, res) => {
  try {
    const { jobId, tutorPhone, transactionId } = req.body;
    
    const newRequest = new UnlockRequest({
      jobId,
      tutorPhone,
      transactionId
    });

    await newRequest.save();
    res.status(201).json({ message: "Payment submitted successfully. Waiting for admin approval." });
  } catch (error) {
    console.error("Unlock error:", error);
    res.status(500).json({ error: "Failed to process unlock request" });
  }
});



// ----------------------------------------------------
// TUTOR ROUTES
// 1. Register a new tutor (Defaults to 'pending')
app.post('/api/tutors', async (req, res) => {
  try {
    const newTutor = new Tutor(req.body);
    const savedTutor = await newTutor.save();
    res.status(201).json(savedTutor);
  } catch (error) {
    res.status(500).json({ error: "Failed to register tutor. Email might already exist." });
  }
});

// 2. Get all tutors (For your Admin Portal)
app.get('/api/tutors', async (req, res) => {
  try {
    const tutors = await Tutor.find();
    res.json(tutors);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tutors" });
  }
});

// 3. Approve a tutor (Changes status from pending to approved)
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
// ----------------------------------------------------
// ----------------------------------------------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});