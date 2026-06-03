const express = require('express');
const app = express();
const path = require('path');
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
app.listen(3006, () => {
  console.log('Test server started on 3006');
});
