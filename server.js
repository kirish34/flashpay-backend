require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// 🔐 Safaricom Daraja Credentials
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const passkey = process.env.PASSKEY;
const shortcode = process.env.SHORTCODE;
const callbackURL = process.env.CALLBACK_URL;
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

  // Notify POS Listener
  try {
    await axios.post('http://localhost:4000/newtx', newTx);
    console.log(`📡 Sent TX ${txCode} to POS Listener`);
  } catch (err) {
    console.error('⚠️ POS Listener Notification Failed:', err.message);
  }

  // Auto-expire
  setTimeout(() => {
    const tx = txCodes.find(tx => tx.code === txCode && tx.status === 'pending');
    if (tx) {
      tx.status = 'expired';
      saveTXs();
      console.log(`TX Code ${txCode} expired.`);
    }
  }, 5 * 60 * 1000);  // Now it waits 5 minutes before expiring
  

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

    const checkoutId = response.data.CheckoutRequestID;
    const latestTX = txCodes.reverse().find(tx => tx.status === 'pending');
    if (latestTX) {
      latestTX.checkoutId = checkoutId;
      saveTXs();
      console.log(`✅ Linked TX ${latestTX.code} → CheckoutID ${checkoutId}`);
    }

    res.json({ message: 'STK Push sent', safaricom: response.data });

  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error('❌ STK Push Failed:', errorDetails);
  
    res.status(500).json({
      error: 'STK Push error',
      safaricom: errorDetails
    });
  }
  

});

// 📥 Callback Handler
app.post('/callback', (req, res) => {
  console.log("📥 M-Pesa Callback Received:");
  console.log(JSON.stringify(req.body, null, 2));

  const callback = req.body?.Body?.stkCallback;
  if (!callback) {
    console.log('❌ Invalid callback format');
    return res.status(400).json({ error: 'Invalid callback format' });
  }

  const checkoutId = callback.CheckoutRequestID;
  const resultCode = callback.ResultCode;

  const matchedTX = txCodes.find(tx => tx.checkoutId === checkoutId);
  if (matchedTX) {
    matchedTX.status = resultCode === 0 ? 'paid' : resultCode === 1032 ? 'cancelled' : 'failed';
    saveTXs();
    console.log(`✅ TX ${matchedTX.code} updated → ${matchedTX.status}`);
  } else {
    console.log('⚠️ No match for callback CheckoutRequestID');
  }

  res.status(200).json({ message: 'Callback processed' });
});


// 📲 USSD-style STK Push
app.post('/pay', async (req, res) => {
  const { txCode, phone } = req.body;
  const tx = txCodes.find(tx => tx.code === txCode && tx.status === 'pending');
  if (!tx) return res.status(404).json({ error: 'TX not found or expired' });

  try {
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: tx.amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackURL,
      AccountReference: 'FlashPayUSSD',
      TransactionDesc: 'USSD Customer Payment'
    };
    
    console.log("📦 Payload to Safaricom:", payload);
    

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    tx.checkoutId = response.data.CheckoutRequestID;
    saveTXs();
    console.log(`📲 USSD STK Push: TX ${tx.code} sent for ${phone}`);
    res.json({ message: 'USSD STK Push sent', safaricom: response.data });

  } catch (err) {
    console.error('❌ STK Push Failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'STK Push error',
      details: err.response?.data || err.message
    });
  }
  
});

// 🔥 Start Server
app.listen(port, () => {
  console.log(`🚀 Flash Pay backend live on http://localhost:${port}`);
});
