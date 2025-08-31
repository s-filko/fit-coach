import { UserDbService } from '@db/services/user-db.service';
import { CreateUserDto, UserResponseDto } from '@models/user.types';
import { AppError } from '@middleware/error';
import { Injectable, Inject } from '@services/di/injectable';

@Injectable()
export class UserService {
  constructor(
    @Inject('UserDbService') private readonly userDb: UserDbService
  ) {
    console.log('UserService initialized with UserDbService');
  }

  async upsertUser(data: CreateUserDto): Promise<UserResponseDto> {
    try {
      console.log('Upserting user with data:', data);
      
      // Validate required fields
      if (!data.provider || !data.providerUserId) {
        console.error('Missing required fields:', { provider: data.provider, providerUserId: data.providerUserId });
        throw new AppError(400, 'Provider and providerUserId are required');
      }

      // Check if user account already exists
      console.log('Checking for existing account...');
      const existingAccount = await this.userDb.findByProvider(data.provider, data.providerUserId);
      console.log('Existing account:', existingAccount);
      
      let user;
      if (existingAccount) {
        // Update existing user
        console.log('Updating existing user...');
        user = await this.userDb.updateUser(existingAccount.userId, data);
      } else {
        // Create new user
        console.log('Creating new user...');
        user = await this.userDb.createUser(data);
      }
      console.log('User after create/update:', user);

      // Get user with accounts
      console.log('Getting user with accounts...');
      const userWithAccounts = await this.userDb.getUserWithAccounts(user.id);
      console.log('User with accounts:', userWithAccounts);
      
      if (!userWithAccounts) {
        console.error('Failed to retrieve created/updated user');
        throw new AppError(500, 'Failed to retrieve created/updated user');
      }

      return userWithAccounts;
    } catch (error) {
      console.error('Error upserting user:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to upsert user');
    }
  }

  async getUser(userId: string): Promise<UserResponseDto | null> {
    try {
      console.log('Getting user:', userId);
      
      // Check if userId is a valid UUID
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        console.error('Invalid UUID format:', userId);
        throw new AppError(404, 'User not found');
      }

      const user = await this.userDb.getUserWithAccounts(userId);
      console.log('Found user:', user);
      return user;
    } catch (error) {
      console.error('Error getting user:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to get user');
    }
  }
} 
 