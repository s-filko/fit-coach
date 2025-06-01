import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import { orchestrate } from "./orchestrator";

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
});

app.post('/api/message', async (req, res) => {
    const { text, userId } = req.body;

    if (!text || !userId) {
        res.status(400).json({ error: 'Missing text or userId' });
        return;
    }

    const replyText = await orchestrate(userId, text);
    res.json({ reply: replyText });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server ready on http://localhost:3000');
});