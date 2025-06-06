import { UserDbService } from '@db/services/user-db.service';
import { CreateUserDto, UserResponseDto } from '@models/user.types';
import { AppError } from '@middleware/error';
import { Injectable, Inject } from '@services/di/injectable';

@Injectable()
export class UserService {
  constructor(
    @Inject('UserDbService') private readonly userDb: UserDbService
  ) {}

  async upsertUser(data: CreateUserDto): Promise<UserResponseDto> {
    try {
      // Check if user account already exists
      const existingAccount = await this.userDb.findByProvider(data.provider, data.providerUserId);
      
      if (existingAccount) {
        // Update existing user
        const user = await this.userDb.updateUser(existingAccount.userId, data);
        const userWithAccounts = await this.userDb.getUserWithAccounts(user.id);
        if (!userWithAccounts) throw new AppError(404, 'User not found');
        return userWithAccounts;
      }

      // Create new user
      const user = await this.userDb.createUser(data);
      const userWithAccounts = await this.userDb.getUserWithAccounts(user.id);
      if (!userWithAccounts) throw new AppError(404, 'User not found');
      return userWithAccounts;
    } catch (error) {
      console.error('Error upserting user:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to upsert user');
    }
  }

  async getUser(userId: string): Promise<UserResponseDto | null> {
    try {
      // Check if userId is a valid UUID
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        throw new AppError(404, 'User not found');
      }
      return await this.userDb.getUserWithAccounts(userId);
    } catch (error) {
      console.error('Error getting user:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to get user');
    }
  }
} 
 