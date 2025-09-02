/**
 * Data Transfer Objects for API communication
 */
export interface MessageDto {
  provider: string;
  providerUserId: string;
  content: string;
}

/**
 * Supported authentication providers
 * Can be extended with additional providers in the future
 */
export const PROVIDERS = {
  TELEGRAM: 'telegram',
} as const;

export type Provider = typeof PROVIDERS[keyof typeof PROVIDERS];

/**
 * AI Chat API types
 */
export interface ChatRequestDto {
  userId: string;
  message: string;
}

export interface ChatResponseDto {
  data: {
    content: string;
    timestamp: string;
  };
}

export interface ErrorResponseDto {
  error: {
    message: string;
  };
}

/**
 * User creation/update types
 */
export interface CreateUserDto {
  provider: Provider;
  providerUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export interface UserDto {
  id: string;
  provider: Provider;
  providerUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * API Response wrapper types
 */
export interface ApiSuccessResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    code?: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse; 