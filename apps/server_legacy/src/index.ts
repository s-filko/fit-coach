import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { registerServices } from '@services/di/register';

// Check if reflect-metadata is working
console.log('Checking reflect-metadata:', {
  hasMetadata: typeof Reflect.getMetadata === 'function',
  hasDefineMetadata: typeof Reflect.defineMetadata === 'function'
});

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize application
async function initializeApp() {
  try {
    // Register services before importing routers
    await registerServices();

    // Import routers after services are registered
    const { userRouter } = await import('@api/user');
    const { messageRouter } = await import('@api/message');
    const { errorHandler } = await import('@middleware/error');

    // Routes
    app.use('/api/user', userRouter);
    app.use('/api/message', messageRouter);

    // Error handling
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errorHandler(err, req, res, next);
    });

    // Start server
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Start the application
initializeApp();