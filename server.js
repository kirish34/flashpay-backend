const cron = require('node-cron');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const app = express();
app.use(express.json());

const FEE_FILE = path.join(__dirname, 'fee-settings.json');
const SAVINGS_FILE = path.join(__dirname, 'saving-settings.json');
const DEDUCTIONS_FILE = path.join(__dirname, 'deduction-logs.json');

// ✅ Save Fee Settings
app.post('/api/sacco/add-fee-setting', async (req, res) => {
  try {
    const feeSettings = await fs.readJson(FEE_FILE).catch(() => []);
    feeSettings.push(req.body);
    await fs.writeJson(FEE_FILE, feeSettings, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error saving fee setting:', err);
    res.status(500).json({ success: false });
  }
});

// ✅ Save Saving Settings
app.post('/api/sacco/add-saving-setting', async (req, res) => {
  try {
    const savings = await fs.readJson(SAVINGS_FILE).catch(() => []);
    savings.push(req.body);
    await fs.writeJson(SAVINGS_FILE, savings, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error saving saving setting:', err);
    res.status(500).json({ success: false });
  }
});

// ✅ Utility: Simulated M-Pesa Deduction
async function deductFromTill(matatuCode, till, amount, type) {
  console.log(`💸 Auto Deduction (${type}): ${matatuCode} → Till ${till} → Amount: KES ${amount}`);

  const logEntry = {
    matatuCode,
    till,
    amount,
    type,
    timestamp: new Date().toISOString()
  };

  try {
    const logs = await fs.readJson(DEDUCTIONS_FILE).catch(() => []);
    logs.push(logEntry);
    await fs.writeJson(DEDUCTIONS_FILE, logs, { spaces: 2 });
  } catch (err) {
    console.error('❌ Failed to log deduction:', err);
  }
}

// ✅ Schedule Auto-Deductions
cron.schedule('* * * * *', async () => {
  console.log('⏱ Checking auto fee and savings collection...');

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // e.g. "07:00"

  // Fee collection
  const fees = await fs.readJson(FEE_FILE).catch(() => []);
  fees.forEach(fee => {
    if (fee.autoCollect && fee.autoTime === currentTime) {
      deductFromTill(fee.matatuCode, fee.tillNumber, fee.dailyFee, 'Fee');
    }
  });

  // Savings collection
  const savings = await fs.readJson(SAVINGS_FILE).catch(() => []);
  savings.forEach(save => {
    if (save.autoCollect && save.autoTime === currentTime) {
      deductFromTill(save.matatuCode, save.tillNumber, save.amount, 'Savings');
    }
  });
});

// ✅ View Deduction Logs
app.get('/api/sacco/deductions-log', async (req, res) => {
  try {
    const logs = await fs.readJson(DEDUCTIONS_FILE).catch(() => []);
    res.json({ records: logs });
  } catch (err) {
    console.error('❌ Failed to load deduction logs:', err);
    res.status(500).json({ error: 'Failed to load deduction logs' });
  }
});

app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));
