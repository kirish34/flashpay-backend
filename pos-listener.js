const express = require('express');
const app = express();
const port = 4000;

app.use(express.json());

// Store received TX codes
let receivedTxCodes = [];

// 📥 Receive new TX code from backend
app.post('/newtx', (req, res) => {
    const newTx = req.body;
    receivedTxCodes.push(newTx);
    console.log('📥 New TX Code received at POS:', newTx);
    res.status(200).json({ message: 'POS received TX Code' });
});

// 🧾 View received TX codes (for debugging)
app.get('/received', (req, res) => {
    res.json(receivedTxCodes);
});

// 🚀 Start the POS listener server
app.listen(port, () => {
    console.log(`📡 POS Listener running at http://localhost:${port}`);
});
