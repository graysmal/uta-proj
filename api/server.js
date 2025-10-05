const express = require('express');
const fileRoutes = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.raw({
    type: 'audio/*',
    limit: '10mb'
}));

// Use file routes
app.use(fileRoutes);

app.listen(PORT, () => {
    console.log(`File API server running on port ${PORT}`);
});