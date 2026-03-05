const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());

const PORT = process.env.PORT || 5000;

// نظام حفظ التقارير (Assessment Results)
let resultsStore = []; 

app.post('/api/save-assessment', (req, res) => {
    const { studentId, unitId, score, grade, feedback } = req.body;
    const report = { id: Date.now(), studentId, unitId, score, grade, feedback, date: new Date() };
    resultsStore.push(report);
    console.log('✅ Result Saved:', report);
    res.status(200).json({ success: true, report });
});

app.get('/api/results', (req, res) => res.json(resultsStore));

app.listen(PORT, () => console.log(🚀 Backend running on port \));
