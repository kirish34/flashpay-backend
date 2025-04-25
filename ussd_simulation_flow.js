const express = require('express');
const axios = require('axios');
const app = express();
const port = 4500;

app.use(express.json());

app.post('/ussd', async (req, res) => {
  const { txCode, msisdn } = req.body;

  if (!txCode || !msisdn) {
    return res.status(400).json({ error: 'Missing txCode or msisdn' });
  }

  try {
    const response = await axios.post('http://localhost:3000/pay', {
      txCode,
      phone: msisdn
    });

    console.log(`✅ STK Push Triggered for TX ${txCode} from ${msisdn}`);
    res.json({ message: 'STK Push sent to customer', safaricom: response.data });
  } catch (err) {
    console.error('❌ Failed to initiate STK Push:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to trigger STK push' });
  }
});

app.listen(port, () => {
  console.log(`📱 USSD Simulation server running at http://localhost:${port}`);
});
