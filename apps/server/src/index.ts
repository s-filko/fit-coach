import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { userRouter } from '@api/user';
import { messageRouter } from '@api/message';
import { errorHandler } from '@middleware/error';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});