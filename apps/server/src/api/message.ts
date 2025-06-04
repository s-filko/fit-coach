import { Router } from 'express';
import { AIService, MessageDto } from '@/services/ai/chat.service';
import { AppError } from '@middleware/error';

const router = Router();
const aiService = new AIService();

router.post('/', async (req, res, next) => {
  try {
    const data: MessageDto = req.body;
    
    if (!data.provider || !data.providerUserId || !data.content) {
      throw new AppError(400, 'Provider, providerUserId and content are required');
    }

    const response = await aiService.processMessage(data);
    res.json({ response });
  } catch (error) {
    next(error);
  }
});

export const messageRouter = router;