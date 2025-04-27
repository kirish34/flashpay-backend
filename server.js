// 📦 Imports
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// 🧠 In-memory Active Bills
let activeBills = {}; // { ussdCode: { amount, phone, status, createdAt } }

// 📁 Cashier Management
const cashiersFile = path.join(__dirname, 'cashiers.json');
let cashiers = []; // { branch, cashierId, ussdCode, till }

// Load Cashiers
fs.readJson(cashiersFile)
  .then(data => {
    cashiers = data;
    console.log('✅ Loaded saved cashiers');
  })
  .catch(() => {
    cashiers = [];
    console.log('⚠️ No existing cashier data. Starting fresh');
  });

// Save Cashiers
function saveCashiers() {
  fs.writeJson(cashiersFile, cashiers, { spaces: 2 })
    .then(() => console.log('💾 Cashiers saved'))
    .catch(err => console.error('❌ Failed to save cashiers:', err));
}

// 🚀 App Initialization
const app = express();
const PORT = process.env.PORT || 10000;

// 📁 Middleware
app.use(cors());
app.use(express.json());

// 🔐 Safaricom Daraja Credentials
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const passkey = process.env.PASSKEY;
const shortcode = process.env.SHORTCODE;
const callbackURL = process.env.CALLBACK_URL;

// 📥 Load TX Codes file (for future)
const txFile = path.join(__dirname, 'txcodes.json');
let txCodes = [];
fs.readJson(txFile)
  .then(data => {
    txCodes = data;
    console.log('✅ Loaded TX codes');
  })
  .catch(() => {
    txCodes = [];
    console.log('⚠️ No saved TX codes. Starting fresh');
  });

// 💾 Save TXs to file
function saveTXs() {
  fs.writeJson(txFile, txCodes, { spaces: 2 })
    .then(() => console.log('💾 TX codes saved'))
    .catch(err => console.error('❌ Failed to save TXs:', err));
}

// 🔑 Get M-Pesa Access Token
async function getAccessToken() {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return response.data.access_token;
}

// 🏡 Root Route
app.get('/', (req, res) => {
  res.send('🚀 Flash Pay API is running!');
});

// 1. 🛠️ Register Cashier
app.post('/register-cashier', (req, res) => {
  const { branch, cashierId, ussdCode, till } = req.body;

  if (!branch || !cashierId || !ussdCode || !till) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const exists = cashiers.find(c => c.ussdCode === ussdCode);
  if (exists) {
    return res.status(400).json({ error: 'USSD Code already assigned' });
  }

  const newCashier = { branch, cashierId, ussdCode, till };
  cashiers.push(newCashier);
  saveCashiers();

  res.json({ message: 'Cashier registered successfully', cashier: newCashier });
});

// 2. 🧾 Cashier Sends Bill
app.post('/pos/send-bill', (req, res) => {
  const { ussdCode, amount } = req.body;

  if (!ussdCode || !amount) {
    return res.status(400).json({ message: 'ussdCode and amount required' });
  }

  // Check if the USSD already has a pending bill
  if (activeBills[ussdCode] && activeBills[ussdCode].status === 'pending') {
    activeBills[ussdCode].status = 'other_payment';
  }

  // Save new bill
  activeBills[ussdCode] = {
    amount,
    phone: null,
    status: 'pending',
    createdAt: new Date()
  };

  console.log(`🧾 New bill: ${ussdCode} => ${amount} KES`);

  res.json({ message: 'Bill received', bill: activeBills[ussdCode] });
});

// 3. 📲 Customer USSD Dial
app.post('/ussd', async (req, res) => {
  const { ussdCode, phoneNumber } = req.body;
  if (!ussdCode || !phoneNumber) {
    return res.status(400).json({ error: 'Missing USSD code or phone number' });
  }

  const bill = activeBills[ussdCode];
  if (!bill) {
    return res.status(404).json({ error: 'No active bill. Wait cashier total.' });
  }
  if (bill.status !== 'pending') {
    return res.status(400).json({ error: 'Bill already handled. Wait for new total.' });
  }

  try {
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: bill.amount,
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackURL,
      AccountReference: 'FlashPay',
      TransactionDesc: `Payment via FlashPay ${ussdCode}`
    };

    await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', stkPayload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    bill.status = 'awaiting_callback';
    bill.phone = phoneNumber;

    res.json({ message: 'STK push sent. Check your phone.' });

  } catch (err) {
    console.error('STK error:', err.message);
    res.status(500).json({ error: 'STK Push Failed' });
  }
});

// 4. 🛜 Safaricom Callback (Upgraded)
app.post('/callback', (req, res) => {
  const callbackData = req.body;
  console.log('📥 Safaricom Callback:', JSON.stringify(callbackData, null, 2));

  // Safaricom will send the "CheckoutRequestID" inside Body
  const resultCode = callbackData.Body?.stkCallback?.ResultCode;
  const resultDesc = callbackData.Body?.stkCallback?.ResultDesc;
  const callbackMetadata = callbackData.Body?.stkCallback?.CallbackMetadata;

  if (resultCode === 0 && callbackMetadata) {
    // Successful payment
    const phoneNumber = callbackMetadata.Item.find(item => item.Name === 'PhoneNumber')?.Value;
    const amountPaid = callbackMetadata.Item.find(item => item.Name === 'Amount')?.Value;

    // Find the matching bill
    const ussdCode = Object.keys(activeBills).find(code => {
      const bill = activeBills[code];
      return bill.phone === phoneNumber && bill.status === 'awaiting_callback';
    });

    if (ussdCode) {
      activeBills[ussdCode].status = 'paid';
      activeBills[ussdCode].paidAmount = amountPaid;
      activeBills[ussdCode].paidAt = new Date();

      console.log(`✅ Payment confirmed for ${ussdCode} (${amountPaid} KES)`);
    } else {
      console.log('⚠️ Callback received but no matching pending bill.');
    }
  } else {
    console.log(`⚠️ Payment failed: ${resultDesc}`);
  }

  res.status(200).json({ message: 'Callback processed' });
});


// 5. 📋 Admin - View Active Bills
app.get('/admin/active-bills', (req, res) => {
  res.json(activeBills);
});

// 6. 🛠️ Admin - Reset Specific Bill
app.post('/admin/reset-bill', (req, res) => {
  const { ussdCode } = req.body;
  if (!ussdCode || !activeBills[ussdCode]) {
    return res.status(404).json({ error: 'USSD code not found' });
  }
  delete activeBills[ussdCode];
  res.json({ message: 'Bill reset successfully' });
});

// 7. ⏳ Auto Timeout for Old Bills
setInterval(() => {
  const now = new Date();
  Object.keys(activeBills).forEach(code => {
    const bill = activeBills[code];
    if (bill.status === 'pending' && (now - new Date(bill.createdAt)) > 2 * 60 * 1000) {
      bill.status = 'timeout';
    }
  });
}, 30000); // every 30 sec

// 🌍 Keep Server Alive (self-ping)
setInterval(() => {
  axios.get('https://flashpay-backend-svkk.onrender.com/')
    .then(() => console.log('🚀 Self-ping successful'))
    .catch((err) => console.error('⚠️ Self-ping failed:', err.message));
}, 1000 * 60 * 4); // every 4 min

// 🔥 Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Flash Pay backend live on http://localhost:${PORT}`);
});
