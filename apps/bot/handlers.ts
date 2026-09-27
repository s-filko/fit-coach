import type TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { errorTextFor } from './error-text';
import { log } from './logger';
import { createChatQueue } from './queue';
import { withTypingIndicator } from './typing-keepalive';
import { quoteLine, voiceNoticeFor, voiceReplyMessages } from './voice';

/** `replyTo` threads the message as a Telegram reply to that message id (voice replies, owner 2026-09-27). */
function replyOptions(replyTo?: number): TelegramBot.SendMessageOptions {
    return replyTo === undefined ? {} : { reply_to_message_id: replyTo, allow_sending_without_reply: true };
}

async function sendHtml(bot: TelegramBot, chatId: number, text: string, replyTo?: number): Promise<void> {
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...replyOptions(replyTo) });
    } catch (htmlError) {
        const isHtmlParseError = htmlError instanceof Error && htmlError.message.includes("can't parse entities");
        if (!isHtmlParseError) {
            throw htmlError;
        }
        log.warn({ chatId, textSnippet: text.slice(0, 100) }, 'HTML parse failed, retrying as plain text');
        try {
            await bot.sendMessage(chatId, text, replyOptions(replyTo));
        } catch (fallbackError) {
            log.error(
                { chatId, htmlError, fallbackError },
                'Plain text fallback also failed after HTML parse error',
            );
            throw fallbackError;
        }
    }
}

const api = axios.create({
    baseURL: process.env.SERVER_URL,
    headers: {
        'X-Api-Key': process.env.BOT_API_KEY || ''
    }
});

// D-H: internal userId cache per SENDER (Telegram `from.id`), in memory, no TTL. Populated on
// /start (and kept fresh by every registerOrGetUser call); cleared on a chat 404 so the next
// message re-upserts through the server instead of retrying against a stale id (self-healing —
// the master plan's own wording). Keyed by the sender, never the chat: an identity must follow
// the person who wrote the message, and a chat-keyed cache is only right while a chat has exactly
// one sender (AC-RRP-4).
//
// BUG-036 + owner language rule (R3): cached alongside the id is the PROFILE
// language (`/api/bot/user`'s `data.languageCode`, additive) — the only
// source of truth for the user's language after account creation. Telegram's
// per-message `language_code` is never read again once a profile is known.
interface CachedUser {
    id: string;
    languageCode: string | undefined;
}
const userIdBySenderId = new Map<number, CachedUser>();

/**
 * The known language for a sender: the cached profile language if this
 * sender has been registered before (in this process), else Telegram's code
 * — the only signal available before a profile exists (same rationale as
 * `nonPrivateChatNotice` below).
 */
function knownLanguageCode(msg: TelegramBot.Message): string | undefined {
    const senderId = msg.from?.id;
    const cached = senderId !== undefined ? userIdBySenderId.get(senderId) : undefined;
    return cached?.languageCode ?? msg.from?.language_code;
}

// The bot serves private chats only (owner decision 2026-09-21): a personal coach whose memory
// and training data belong to one person. In any other chat it makes no API call and answers
// once per chat, so a busy group is not spammed. Bounded so a bot added to many groups cannot
// grow the set without limit; the oldest entry is forgotten first (worst case: one extra notice).
const NON_PRIVATE_NOTICE_LIMIT = 1000;
const noticedNonPrivateChats = new Set<number>();

// BUG-036 + owner language rule (R3): this one text is the sole exception to
// "the profile decides" — no user is registered yet at this point (the bot
// makes no API call for a non-private chat), so no profile language exists
// to read. Telegram's per-message code is the only signal available here.
function nonPrivateChatNotice(languageCode: string | undefined): string {
    return languageCode === 'ru'
        ? 'Я работаю только в личном чате — напиши мне в личные сообщения.'
        : 'I only work in a private chat — please message me directly.';
}

async function refuseNonPrivateChat(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    if (noticedNonPrivateChats.has(chatId)) {
        return;
    }
    noticedNonPrivateChats.add(chatId);
    if (noticedNonPrivateChats.size > NON_PRIVATE_NOTICE_LIMIT) {
        const oldest = noticedNonPrivateChats.values().next().value;
        if (oldest !== undefined) {
            noticedNonPrivateChats.delete(oldest);
        }
    }
    log.info({ chatId, chatType: msg.chat.type }, 'non-private chat — answering once that only private chats are served');
    try {
        await bot.sendMessage(chatId, nonPrivateChatNotice(msg.from?.language_code));
    } catch (err) {
        log.warn({ err: String(err), chatId }, 'could not send the private-chat-only notice');
    }
}

const chatQueue = createChatQueue();

// D6: voice only — audio files, video notes and documents are out of scope.
const MAX_VOICE_DURATION_S = 300;
// Telegram voice is always OGG/Opus; the server passes it to the STT provider as-is.
const VOICE_MIME_TYPE = 'audio/ogg';

/** The transcribe call's failure mode: 422 NO_SPEECH, anything else STT_UNAVAILABLE (D3/D8). */
function sttNoticeKindOf(error: unknown): 'NO_SPEECH' | 'STT_UNAVAILABLE' {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    return status === 422 ? 'NO_SPEECH' : 'STT_UNAVAILABLE';
}

/** D6: the bot never holds a provider key — audio goes to the server as base64. */
async function downloadVoiceAsBase64(bot: TelegramBot, fileId: string): Promise<string> {
    const stream = bot.getFileStream(fileId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('base64');
}

/**
 * D6: one voice message → transcribe via the server → the transcript is the
 * user's message (D5), sent to /api/bot/chat unchanged → the reply is quote +
 * coach answer (D7). Runs inside the caller's chatQueue + withTypingIndicator.
 * STT failures send the D8 notice and never reach /chat; chat errors after a
 * successful transcription keep the errorTextFor path, preceded by the quote.
 */
async function handleVoiceMessage(bot: TelegramBot, msg: TelegramBot.Message, voice: TelegramBot.Voice): Promise<void> {
    const chatId = msg.chat.id;

    if (voice.duration > MAX_VOICE_DURATION_S) {
        await bot.sendMessage(chatId, voiceNoticeFor('TOO_LONG', knownLanguageCode(msg)), replyOptions(msg.message_id));
        return;
    }

    // R6 (Task 3): a sub-second voice is an accidental tap — no speech in it.
    // Same notice as NO_SPEECH, without a pointless download and STT call.
    if (voice.duration < 1) {
        await bot.sendMessage(chatId, voiceNoticeFor('NO_SPEECH', knownLanguageCode(msg)), replyOptions(msg.message_id));
        return;
    }

    try {
        await withTypingIndicator(bot, chatId, async () => {
            const user = await registerOrGetUser(msg);
            const audioBase64 = await downloadVoiceAsBase64(bot, voice.file_id);

            let transcript: string;
            try {
                const sttResponse = await api.post('/api/bot/voice/transcribe', {
                    userId: user.id,
                    audioBase64,
                    mimeType: VOICE_MIME_TYPE,
                });
                const text = sttResponse.data?.data?.text;
                if (typeof text !== 'string') {
                    throw new Error('Invalid transcription response');
                }
                transcript = text;
            } catch (sttError) {
                // A stale cached userId is not an STT problem — let the outer
                // handler do the self-healing (clear cache, errorTextFor).
                if (isNotFound(sttError)) {
                    throw sttError;
                }
                log.warn({ err: sttError, chatId }, 'voice transcription failed');
                await bot.sendMessage(chatId, voiceNoticeFor(sttNoticeKindOf(sttError), knownLanguageCode(msg)), replyOptions(msg.message_id));
                return;
            }

            try {
                await chatAndReply(
                    bot,
                    msg,
                    chatId,
                    user.id,
                    transcript,
                    // D7: quote + reply (split over 4096, or quote only when the reply is empty).
                    async content => {
                        for (const part of voiceReplyMessages(transcript, content)) {
                            // Every part replies to the voice note, so the answer is threaded to it.
                            await sendHtml(bot, chatId, part, msg.message_id);
                        }
                    },
                    'voice chat processing failed',
                    // D8: the quote first so the user sees what was heard, then the usual error text.
                    { beforeErrorText: async () => sendHtml(bot, chatId, quoteLine(transcript), msg.message_id) },
                );
            } catch (sendError) {
                // A10 (Task 4): a Telegram send failure after a successful
                // chat is not a chat error — the coach's answer was produced;
                // log and stop, no second quote, no chat-error text.
                log.error({ err: sendError, chatId }, 'sending the voice reply failed');
            }
        });
    } catch (error) {
        // registerOrGetUser / download / a 404 re-thrown from above.
        await reportFailure(bot, msg, chatId, error, 'voice message processing failed');
    }
}

/** True for an axios error whose response status is 404 (a stale cached userId). */
function isNotFound(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}

/** The server's ConversationErrorCode (ADR-0013 §6), when the error is a typed axios response. */
function conversationErrorCodeOf(error: unknown): string | undefined {
    if (!axios.isAxiosError(error)) {
        return undefined;
    }
    const code = error.response?.data?.error?.code;
    return typeof code === 'string' ? code : undefined;
}

/**
 * F4 (Task 4, B2): the one failure tail shared by chatAndReply's catch and
 * the outer catches of /start, the text path and the voice path — 404 clears
 * the cached id, the error is logged (with the axios status/responseData when
 * present) under the caller's label, and the user gets the localized
 * errorTextFor message — optionally preceded by `beforeErrorText` (the voice
 * quote, D8).
 */
async function reportFailure(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    chatId: number,
    error: unknown,
    logLabel: string,
    beforeErrorText?: () => Promise<void>,
): Promise<void> {
    if (isNotFound(error) && msg.from) {
        userIdBySenderId.delete(msg.from.id);
    }
    log.error({
        err: error,
        username: msg.from?.username,
        ...(axios.isAxiosError(error) && {
            status: error.response?.status,
            responseData: error.response?.data,
        }),
    }, logLabel);
    if (beforeErrorText) {
        await beforeErrorText();
    }
    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), knownLanguageCode(msg)));
}

/**
 * F1 (Task 4, B2): the one shared chat sequence — post /api/bot/chat,
 * validate data.content, and the failure tail (404 → clear the cached id,
 * log.error with axios status/responseData, errorTextFor). Used by the text
 * path, /start and the voice path; each passes its reply rendering in
 * `sendReply` and its log label. A Telegram failure inside `sendReply` or
 * `beforeErrorText` happens AFTER the catch, so it is never treated as a
 * chat error (A10) — it propagates to the caller.
 */
async function chatAndReply(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    chatId: number,
    userId: string,
    message: string,
    sendReply: (content: string) => Promise<void>,
    logLabel: string,
    options: { beforeErrorText?: () => Promise<void> } = {},
): Promise<void> {
    let content: string;
    try {
        const chatResponse = await api.post('/api/bot/chat', {
            userId,
            message,
        });
        const aiResponse = chatResponse.data?.data?.content;
        if (typeof aiResponse !== 'string') {
            throw new Error('Invalid response from AI service');
        }
        content = aiResponse;
    } catch (error) {
        await reportFailure(bot, msg, chatId, error, logLabel, options.beforeErrorText);
        return;
    }
    await sendReply(content);
}

async function registerOrGetUser(msg: TelegramBot.Message) {
    if (!msg.from) {
        throw new Error('Cannot determine user information');
    }

    const cached = userIdBySenderId.get(msg.from.id);
    if (cached) {
        return { id: cached.id, firstName: msg.from.first_name, username: msg.from.username, languageCode: cached.languageCode };
    }

    const userResponse = await api.post('/api/bot/user', {
        provider: 'telegram',
        providerUserId: String(msg.from.id),
        username: msg.from.username || undefined,
        firstName: msg.from.first_name || undefined,
        lastName: msg.from.last_name || undefined,
        languageCode: msg.from.language_code || undefined,
    });

    const userId = userResponse.data?.data?.id;
    if (!userId) {
        throw new Error('Invalid response from server: missing data.id');
    }

    // BUG-036 + owner language rule (R3): languageCode is the PROFILE
    // language (additive on /api/bot/user) — on a first-ever message it
    // equals Telegram's code (just seeded), but stays correct afterwards
    // even after the user switches it with set_language.
    const languageCode: string | undefined = userResponse.data?.data?.languageCode ?? undefined;
    userIdBySenderId.set(msg.from.id, { id: userId, languageCode });
    return { id: userId, firstName: msg.from.first_name, username: msg.from.username, languageCode };
}

export function registerBotHandlers(bot: TelegramBot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;

        // Private chats only: no API call, no identity lookup, no queue for anything else.
        if (msg.chat.type !== 'private') {
            await refuseNonPrivateChat(bot, msg);
            return;
        }

        // D-G: serialise everything for one chatId so the bot never fires a
        // second HTTP request while the first is still in flight (client-side
        // politeness — the server's per-userId mutex is the real guarantee).
        await chatQueue.enqueue(chatId, async () => {
            const userText = msg.text;
            log.info({
                username: msg.from?.username,
                chatId,
                textLength: userText?.length,
                command: userText?.startsWith('/') ? userText.split(' ')[0] : undefined,
            }, 'incoming message');

            if (!msg.from) {
                await bot.sendMessage(
                    chatId,
                    'Sorry, I cannot determine user information. Please try again.'
                );
                return;
            }

            if (userText === '/clear_context') {
                try {
                    await withTypingIndicator(bot, chatId, async () => {
                        const user = await registerOrGetUser(msg);
                        await api.post('/api/bot/chat/clear-context', { userId: user.id });
                    });
                    await bot.sendMessage(chatId, '🧹 Context cleared. Starting fresh!');
                } catch (error) {
                    if (isNotFound(error)) {
                        userIdBySenderId.delete(msg.from.id);
                    }
                    log.error({ err: error }, '/clear_context failed');
                    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), knownLanguageCode(msg)));
                }
                return;
            }

            if (userText === '/compact') {
                try {
                    const outcome = await withTypingIndicator(bot, chatId, async () => {
                        const user = await registerOrGetUser(msg);
                        const res = await api.post('/api/bot/chat/compact', { userId: user.id });
                        return (res.data?.data?.outcome as 'compacted' | 'nothing_to_compact' | undefined) ?? 'nothing_to_compact';
                    });
                    const isRu = knownLanguageCode(msg) === 'ru';
                    const reply = outcome === 'compacted'
                        ? (isRu ? 'Разговор сохранён в память.' : 'The conversation so far has been folded into memory.')
                        : (isRu ? 'Пока нечего сохранять в память.' : 'Nothing to fold into memory yet.');
                    await bot.sendMessage(chatId, reply);
                } catch (error) {
                    if (isNotFound(error)) {
                        userIdBySenderId.delete(msg.from.id);
                    }
                    log.error({ err: error }, '/compact failed');
                    await bot.sendMessage(chatId, errorTextFor(conversationErrorCodeOf(error), knownLanguageCode(msg)));
                }
                return;
            }

            if (userText === '/start') {
                try {
                    await withTypingIndicator(bot, chatId, async () => {
                        // Register user and get the personalized LLM greeting.
                        const user = await registerOrGetUser(msg);

                        await chatAndReply(bot, msg, chatId, user.id, 'hi', async content => {
                            if (!content.trim()) {
                                log.warn({ chatId, username: msg.from?.username }, 'LLM returned empty response on /start, suppressing');
                                return;
                            }
                            await sendHtml(bot, chatId, content);
                        }, '/start command failed');
                    });
                } catch (error) {
                    await reportFailure(bot, msg, chatId, error, '/start command failed');
                }
                return;
            }

            // Voice messages have no msg.text — handle them before the text gate drops them.
            if (msg.voice) {
                await handleVoiceMessage(bot, msg, msg.voice);
                return;
            }

            if (!userText) return;

            try {
                await withTypingIndicator(bot, chatId, async () => {
                    // Ensure user exists to get userId
                    const user = await registerOrGetUser(msg);

                    await chatAndReply(bot, msg, chatId, user.id, userText, async content => {
                        if (!content.trim()) {
                            log.warn({ chatId, username: msg.from?.username, userText }, 'LLM returned empty response, suppressing');
                            return;
                        }
                        await sendHtml(bot, chatId, content);
                    }, 'message processing failed');
                });
            } catch (error) {
                await reportFailure(bot, msg, chatId, error, 'message processing failed');
            }
        });
    });
}