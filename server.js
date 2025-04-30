// 📦 Imports
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// 🗂️ File Paths
const usersFile = path.join(__dirname, 'users.json');
const cashiersFile = path.join(__dirname, 'cashiers.json');
const branchesFile = path.join(__dirname, 'branches.json');
const txFile = path.join(__dirname, 'txcodes.json');

// 🔄 In-Memory Storage
let users = [];
let cashiers = [];
let branches = [];
let txCodes = [];
let activeBills = {}; // { ussdCode: { amount, phone, status, createdAt } }

// 📥 Load Data
fs.readJson(usersFile).then(data => users = data).catch(() => {});
fs.readJson(cashiersFile).then(data => cashiers = data).catch(() => {});
fs.readJson(branchesFile).then(data => branches = data).catch(() => {});
fs.readJson(txFile).then(data => txCodes = data).catch(() => {});

// 💾 Save Functions
const saveCashiers = () => fs.writeJson(cashiersFile, cashiers, { spaces: 2 });
const saveBranches = () => fs.writeJson(branchesFile, branches, { spaces: 2 });
const saveTXs = () => fs.writeJson(txFile, txCodes, { spaces: 2 });

// 🚀 App Setup
const app = express();
const PORT = process.env.PORT || 10000;

// 🔧 Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔐 Safaricom Credentials
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const passkey = process.env.PASSKEY;
const shortcode = process.env.SHORTCODE;
const callbackURL = process.env.CALLBACK_URL;

// 🏁 Root
app.get('/', (req, res) => res.send('🚀 Flash Pay API is running!'));

// 🌐 Frontend Routes
app.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/branch-dashboard', (_, res) => res.sendFile(path.join(__dirname, 'public', 'branch-dashboard.html')));
app.get('/pos', (_, res) => res.sendFile(path.join(__dirname, 'public', 'pos.html')));
app.get('/ussd-simulator', (_, res) => res.sendFile(path.join(__dirname, 'public', 'ussd-simulator.html')));

// 🔑 Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) return res.json({ success: true, role: user.role });
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// ✅ ADMIN: Register Branch
app.post('/api/admin/register-branch', (req, res) => {
  const { name, tillNumber } = req.body;
  if (!name || !tillNumber) return res.status(400).json({ message: 'Missing branch name or till number' });

  const exists = branches.find(b => b.name === name);
  if (exists) return res.status(400).json({ message: 'Branch already exists' });

  const newBranch = { name, tillNumber };
  branches.push(newBranch);
  saveBranches();

  res.json({ message: 'Branch registered successfully', branch: newBranch });
});

// ✅ ADMIN: Register Cashier
app.post('/api/admin/register-cashier', (req, res) => {
  const { branch, cashierId, ussdCode } = req.body;
  if (!branch || !cashierId || !ussdCode) return res.status(400).json({ error: 'Missing required fields' });

  const branchInfo = branches.find(b => b.name === branch);
  if (!branchInfo) return res.status(400).json({ error: 'Branch does not exist' });

  const exists = cashiers.find(c => c.ussdCode === ussdCode);
  if (exists) return res.status(400).json({ error: 'USSD code already assigned' });

  const newCashier = {
    branch,
    cashierId,
    ussdCode,
    till: branchInfo.tillNumber
  };

  cashiers.push(newCashier);
  saveCashiers();

  res.json({ message: 'Cashier registered successfully', cashier: newCashier });
});

// ✅ ADMIN: List Branches
app.get('/api/admin/branches', (req, res) => {
  res.json(branches);
});

// ✅ ADMIN: Branch Stats Dashboard
app.get('/api/admin/branch-stats', (req, res) => {
  const stats = branches.map(branch => {
    const branchCashiers = cashiers.filter(c => c.branch === branch.name);
    const branchUssdCodes = branchCashiers.map(c => c.ussdCode);

    const transactions = Object.entries(activeBills).filter(([code]) =>
      branchUssdCodes.includes(code)
    ).map(([_, bill]) => bill);

    const totalTransactions = transactions.length;
    const paid = transactions.filter(b => b.status === 'paid').length;
    const waiting = transactions.filter(b => ['pending', 'awaiting_callback'].includes(b.status)).length;
    const failed = transactions.filter(b => ['timeout', 'other_payment'].includes(b.status)).length;

    return {
      name: branch.name,
      tillNumber: branch.tillNumber,
      totalTransactions,
      paid,
      waiting,
      failed,
      activeCashiers: branchCashiers.length
    };
  });

  res.json(stats);
});

// ✅ POS: Send Bill
app.post('/pos/send-bill', (req, res) => {
  const { ussdCode, amount } = req.body;
  if (!ussdCode || !amount) return res.status(400).json({ message: 'ussdCode and amount required' });

  if (activeBills[ussdCode] && activeBills[ussdCode].status === 'pending') {
    activeBills[ussdCode].status = 'other_payment';
  }

  activeBills[ussdCode] = {
    amount,
    phone: null,
    status: 'pending',
    createdAt: new Date()
  };

  console.log(`🧾 New bill: ${ussdCode} => ${amount} KES`);
  res.json({ message: 'Bill received', bill: activeBills[ussdCode] });
});

// ✅ Customer Dials USSD
app.post('/ussd', async (req, res) => {
  const { ussdCode, phoneNumber } = req.body;
  if (!ussdCode || !phoneNumber) return res.status(400).json({ error: 'Missing USSD code or phone number' });

  const bill = activeBills[ussdCode];
  if (!bill) return res.status(404).json({ error: 'No active bill. Wait cashier total.' });
  if (bill.status !== 'pending') return res.status(400).json({ error: 'Bill already handled.' });

  try {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const { data } = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` }
    });

    const token = data.access_token;
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

// ✅ Safaricom Callback
app.post('/callback', (req, res) => {
  const data = req.body;
  const resultCode = data.Body?.stkCallback?.ResultCode;
  const callbackMetadata = data.Body?.stkCallback?.CallbackMetadata;

  if (resultCode === 0 && callbackMetadata) {
    const phone = callbackMetadata.Item.find(i => i.Name === 'PhoneNumber')?.Value;
    const amountPaid = callbackMetadata.Item.find(i => i.Name === 'Amount')?.Value;

    const ussdCode = Object.keys(activeBills).find(code => {
      const bill = activeBills[code];
      return bill.phone === phone && bill.status === 'awaiting_callback';
    });

    if (ussdCode) {
      activeBills[ussdCode].status = 'paid';
      activeBills[ussdCode].paidAmount = amountPaid;
      activeBills[ussdCode].paidAt = new Date();
      console.log(`✅ Payment confirmed for ${ussdCode} (${amountPaid} KES)`);
    }
  }

  res.status(200).json({ message: 'Callback processed' });
});

// ✅ Admin: View Active Bills
app.get('/admin/active-bills', (req, res) => {
  res.json(activeBills);
});

// ✅ Admin: Reset Bill
app.post('/admin/reset-bill', (req, res) => {
  const { ussdCode } = req.body;
  if (!ussdCode || !activeBills[ussdCode]) return res.status(404).json({ error: 'USSD code not found' });
  delete activeBills[ussdCode];
  res.json({ message: 'Bill reset successfully' });
});

// ⏳ Timeout Old Bills
setInterval(() => {
  const now = new Date();
  Object.keys(activeBills).forEach(code => {
    const bill = activeBills[code];
    if (bill.status === 'pending' && (now - new Date(bill.createdAt)) > 2 * 60 * 1000) {
      bill.status = 'timeout';
    }
  });
}, 30000);

// 🌍 Self Ping
setInterval(() => {
  axios.get('https://flashpay-backend-svkk.onrender.com/')
    .then(() => console.log('🚀 Self-ping successful'))
    .catch((err) => console.error('⚠️ Self-ping failed:', err.message));
}, 1000 * 60 * 4);

// ✅ Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Flash Pay backend live on http://localhost:${PORT}`);
});
