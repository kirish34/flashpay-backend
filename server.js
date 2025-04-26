// 📦 Imports
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// 🚀 App Initialization
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// 🚀 Add this POST route handler:
app.post('/generate', (req, res) => {
    const { amount, till } = req.body;
    if (!amount || !till) {
        return res.status(400).json({ message: 'Missing amount or till' });
    }
    // Example response (You can modify later)
    res.status(200).json({ message: `Generated code for amount ${amount} and till ${till}` });
});

// Default route (this is already working)
app.get('/', (req, res) => {
    res.send('🚀 Flash Pay API is running!');
});

// Bind to 0.0.0.0 for Render
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Flash Pay backend live on http://localhost:${PORT}`);
});


// Test Route - homepage
app.get('/', (req, res) => {
  res.send('🚀 Flash Pay API is running!');
});

// Real Route - for POST /generate
app.post('/generate', async (req, res) => {
  const { amount, till } = req.body;

  if (!amount || !till) {
    return res.status(400).json({ error: 'Amount and Till are required' });
  }

  const txCode = Math.floor(1000 + Math.random() * 9000);

  const newTx = {
    code: txCode,
    amount,
    till,
    createdAt: new Date(),
    status: 'pending'
  };

  res.json({ message: 'TX code generated', tx: newTx });
});

// 🔥 Start Server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Flash Pay backend live on port ${port}`);
});

// 🔐 Safaricom Daraja Credentials
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const passkey = process.env.PASSKEY;
const shortcode = process.env.SHORTCODE;
const callbackURL = process.env.CALLBACK_URL;

// 📁 TX Code file path
const txFile = path.join(__dirname, 'txcodes.json');

// 🧠 In-memory TX storage
let txCodes = [];

// 📥 Load TXs from file on startup
fs.readJson(txFile)
  .then(data => {
    txCodes = data;
    console.log('✅ Loaded saved TX codes');
  })
  .catch(() => {
    txCodes = [];
    console.log('⚠️ No existing TX data found. Starting fresh');
  });

// 💾 Save TXs to file
function saveTXs() {
  fs.writeJson(txFile, txCodes, { spaces: 2 })
    .then(() => console.log('💾 TX codes saved to txcodes.json'))
    .catch(err => console.error('❌ Failed to save TXs:', err));
}

// 🏡 Root route for Render
app.get('/', (req, res) => {
  res.send('🚀 Flash Pay API is running!');
});

// 🔁 Generate TX Code
app.post('/generate', async (req, res) => {
  const { amount, till } = req.body;
  const txCode = Math.floor(1000 + Math.random() * 9000);

  const newTx = {
    code: txCode,
    amount,
    till,
    createdAt: new Date(),
    status: 'pending'
  };

  txCodes.push(newTx);
  saveTXs();

  res.json({ message: 'TX code generated', tx: newTx });
});

// 🔎 View all TX codes
app.get('/txcodes', (req, res) => {
  res.json(txCodes);
});

// 🔑 Get M-Pesa Access Token
async function getAccessToken() {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return response.data.access_token;
}

// 💳 Manual STK Push Trigger
app.post('/stkpush', async (req, res) => {
  const { phone, amount } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'Missing phone or amount' });

  try {
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackURL,
      AccountReference: 'FlashPayTX',
      TransactionDesc: 'Manual STK Push'
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({ message: 'STK Push sent', safaricom: response.data });

  } catch (err) {
    console.error('❌ STK Push Failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'STK Push error', details: err.response?.data || err.message });
  }
});

// 📥 Callback Receiver
app.post('/callback', (req, res) => {
  console.log('📥 M-Pesa Callback Received:', JSON.stringify(req.body, null, 2));
  res.status(200).json({ message: 'Callback processed' });
});

// 🔥 Start Server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Flash Pay backend live on port ${port}`);
});

