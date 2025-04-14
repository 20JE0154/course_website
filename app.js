const express = require('express');
const Razorpay = require('razorpay');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Razorpay instance
const razorpay = new Razorpay({
  key_id: 'rzp_test_CXYxQoaBkZNEhh',
  key_secret: 'Eq4sVGwWkVDgJLvPy0Oh5lm9'
});

// Helper to read JSON
const readJSON = (file) => {
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file));
  }
  return [];
};

// Store payments in a file (or better, a database in production)
const savePayment = (paymentData) => {
  const payments = readJSON('payments.json');
  payments.push(paymentData);
  fs.writeFileSync('payments.json', JSON.stringify(payments, null, 2));
};

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
    res.status(500).send('Error creating order');
  }
});

// Verify payment
app.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, course_id } = req.body;

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

    // Respond with success and course link
    const links = readJSON('courselink.json');
    const course = links.find(c => c.course_id === parseInt(course_id));

    if (course) {
      res.json({ status: 'ok', course_link: course.link });
    } else {
      res.status(404).json({ status: 'course_not_found' });
    }
  } else {
    res.status(400).json({ status: 'verification_failed' });
  }
});

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
          </style>
        </head>
        <body>
          <h1>✔️ Payment Successful!</h1>
          <p>Your course is ready. Click the link below to access it:</p>
          <p><code><a href="${course.link}" target="_blank">${course.link}</a></code></p>
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
