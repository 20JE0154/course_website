require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');  // Add Nodemailer to send email

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
//app.use(express.static(__dirname));

// Razorpay instance with key_id and key_secret from environment variables
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,  // Use the environment variable for key_id
  key_secret: process.env.RAZORPAY_KEY_SECRET  // Use the environment variable for key_secret
});

// Helper to read JSON
const readJSON = (file) => {
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file));
  }
  return [];
};
//Helper to write JSON
function writeJSON(file, data) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}

// Store payments in a file (or better, a database in production)
const savePayment = (paymentData) => {
  const payments = readJSON('payments.json');
  payments.push(paymentData);
  fs.writeFileSync('payments.json', JSON.stringify(payments, null, 2));
};

// Serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// Serve index page
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// serve admin page 
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
// post request to add courses
app.post('/admin/add-course', (req, res) => {
  const { name, price, link, secret } = req.body;

  if (secret !== process.env.ADMIN_CODE) {
    return res.status(403).send("Invalid secret code.");
  }

  const courses = readJSON('courses.json');
  const links = readJSON('courselink.json');

  const nextId = courses.length > 0 ? courses[courses.length - 1].course_id + 1 : 1;

  const newCourse = {
    course_id: nextId,
    name,
    price: parseInt(price)
  };

  const newLink = {
    course_id: nextId,
    link
  };

  courses.push(newCourse);
  links.push(newLink);

  writeJSON('courses.json', courses);
  writeJSON('courselink.json', links);

  res.send("Course added successfully!");
});
// Serve to delete course
app.post('/admin/delete-course', (req, res) => {
  const { course_id, secret } = req.body;

  if (secret !== process.env.ADMIN_CODE) {
    return res.status(401).send('Unauthorized: Invalid secret code');
  }

  let courses = readJSON('courses.json');
  let courselinks = readJSON('courselink.json');

  const id = parseInt(course_id);

  const courseExists = courses.some(course => course.course_id === id);
  if (!courseExists) {
    return res.status(404).send('Course not found');
  }

  // Filter out the course from both files
  courses = courses.filter(course => course.course_id !== id);
  courselinks = courselinks.filter(link => link.course_id !== id);

  writeJSON('courses.json', courses);
  writeJSON('courselink.json', courselinks);

  res.send('Course deleted successfully');
});

app.use(express.static(__dirname)); // i have moved this here 
// Serve course list
app.get('/courses', (req, res) => {
  const courses = readJSON('courses.json');
  res.json(courses);
});

// Create order
app.post('/create-order', async (req, res) => {
  try {
    const { amount, course_id } = req.body;

    const options = {
      amount: parseInt(amount),
      currency: 'INR',
      receipt: `receipt_${course_id}`,
      notes: { course_id }
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).send('Error creating order');
  }
});

// Verify payment
app.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, course_id, email } = req.body;

  // Check payment signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', razorpay.key_secret)
    .update(body)
    .digest('hex');

  if (expectedSignature === razorpay_signature) {
    // Fetch the order to confirm course_id from Razorpay's stored data
    const razorpayOrder = await razorpay.orders.fetch(razorpay_order_id);
    const course_id_from_order = razorpayOrder.notes.course_id;

    // Make sure the course_id matches
    if (parseInt(course_id_from_order) !== parseInt(course_id)) {
      return res.status(403).json({ status: 'invalid_course_access' });
    }

    // Save the payment info
    savePayment({
      payment_id: razorpay_payment_id,
      course_id,
      timestamp: Date.now()
    });

    // Send email with the course link
    const links = readJSON('courselink.json');
    const course = links.find(c => c.course_id === parseInt(course_id));

    if (course) {
      // Send email to the user
      sendEmail(email, course.link);

      res.json({ status: 'ok', course_link: course.link });
    } else {
      res.status(404).json({ status: 'course_not_found' });
    }
  } else {
    res.status(400).json({ status: 'verification_failed' });
  }
});

// Function to send email
const sendEmail = (toEmail, courseLink) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.EMAIL,
    to: toEmail,
    subject: 'Your Course Link',
    text: `Thank you for your purchase! You can access your course by clicking the link below:\n\n${courseLink}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error sending email:', error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
};

// Serve payment success with course link
app.get('/payment-success', (req, res) => {
  const { payment_id, course_id } = req.query;
  const payments = readJSON('payments.json');
  const payment = payments.find(p => p.payment_id === payment_id && p.course_id === parseInt(course_id));

  if (payment) {
    const links = readJSON('courselink.json');
    const course = links.find(c => c.course_id === parseInt(course_id));

    if (course) {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Payment Successful</title>
          <style>
            body {
              font-family: sans-serif;
              text-align: center;
              padding: 50px;
              background: #f4f4f4;
            }
            code {
              background: #eee;
              padding: 10px;
              display: inline-block;
              border-radius: 5px;
            }
            a {
              color: #007bff;
              text-decoration: underline;
            }
            img {
              width: 100px;
              height: 100px;
            }
          </style>
        </head>
        <body>
          <h1>✔️ Payment Successful!</h1>
          <p>Your course is ready. Click the link below to access it:</p>
          <p><code><a href="${course.link}" target="_blank">${course.link}</a></code></p>
          <p>✅ Course link has also been sent to your email.</p>

          <div style="text-align: center; margin-top: 20px;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/4e/Gmail_Icon.png" alt="Gmail">
            <p style="font-weight: bold; color: red; margin-top: 10px;">📢 Must check your spam folder!</p>
          </div>
        </body>
        </html>
      `);
    } else {
      res.status(404).send('Course not found.');
    }
  } else {
    res.status(403).send('Payment verification failed.');
  }
});

// Contact route to fetch contact details from .env
app.get('/contact', (req, res) => {
  res.json({
    telegram: process.env.CONTACT_TELEGRAM,
    email: process.env.CONTACT_EMAIL
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
