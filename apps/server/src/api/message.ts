import { Router } from 'express';
import { AIContextService } from '@services/ai/ai-context.service';
import { AppError } from '@middleware/error';

const router = Router();
const aiContextService = new AIContextService();

router.post('/', async (req, res, next) => {
  try {
    const { userId, message } = req.body;
    
    if (!userId || !message) {
      throw new AppError(400, 'userId and message are required');
    }

    const response = await aiContextService.processMessage(userId, message);
    res.json({ response });
  } catch (error) {
    next(error);
  }
});

export const messageRouter = router;