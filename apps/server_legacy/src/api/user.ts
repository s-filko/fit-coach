// apps/server/src/api/user.ts

import { Router, RequestHandler } from 'express';
import { Container } from '@services/di/injectable';
import { UserService } from '@services/user.service';
import { CreateUserDto } from '@models/user.types';

const router = Router();
const container = Container.getInstance();

const getUserHandler: RequestHandler = async (req, res, next) => {
  try {
    const userService = container.get<UserService>('UserService');
    const user = await userService.getUser(req.params.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

const createUserHandler: RequestHandler = async (req, res, next) => {
  try {
    const userService = container.get<UserService>('UserService');
    const userData: CreateUserDto = req.body;
    // Simple validation
    if (!userData.provider || !userData.providerUserId || !userData.firstName || !userData.languageCode) {
      res.status(400).json({ message: 'Missing required user fields' });
      return;
    }
    const user = await userService.upsertUser(userData);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

router.get('/:id', getUserHandler);
router.post('/', createUserHandler);

export { router as userRouter };