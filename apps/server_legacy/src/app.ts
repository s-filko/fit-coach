import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { registerServices } from '@services/di/register';

// Register services before importing routers
registerServices();

import { userRouter } from '@api/user';
import { messageRouter } from '@api/message';
import { errorHandler } from '@middleware/error';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/user', userRouter);
app.use('/api/message', messageRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  errorHandler(err, req, res, next);
});

export { app }; 