export interface MessageDto {
  provider: string;
  providerUserId: string;
  content: string;
}

export const PROVIDERS = {
  TELEGRAM: 'telegram',
} as const;

export type Provider = typeof PROVIDERS[keyof typeof PROVIDERS]; 