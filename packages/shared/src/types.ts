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