// apps/server/src/api/user.ts

import { Router } from 'express';
import { UserService } from '@/services/user.service';
import { CreateUserDto } from "@/models/user.types";
import { AppError } from '@middleware/error';

const router = Router();
const userService = new UserService();

router.post('/', async (req, res, next) => {
  try {
    const data: CreateUserDto = req.body;
    
    if (!data.provider || !data.providerUserId) {
      throw new AppError(400, 'Provider and providerUserId are required');
    }

    const result = await userService.upsertUser(data);
    res.json({ user: result });
  } catch (error) {
    next(error);
  }
});

export const userRouter = router;