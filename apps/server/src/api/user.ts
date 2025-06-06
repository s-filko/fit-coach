// apps/server/src/api/user.ts

import { Router, RequestHandler } from 'express';
import { Container } from '@services/di/injectable';
import { UserService } from '@services/user.service';

const router = Router();
const container = Container.getInstance();
const userService = container.resolve(UserService) as UserService;

const getUserHandler: RequestHandler = async (req, res, next) => {
  try {
    const user = await userService.getUser(req.params.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
};

router.get('/:id', getUserHandler);

export { router as userRouter };