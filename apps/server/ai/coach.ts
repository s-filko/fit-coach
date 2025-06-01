import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Initializes the fitness coach AI model
 */
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY!,
    temperature: 0.7,
    model: 'gpt-4',
});

/**
 * Returns a reply from the AI fitness coach
 * @param text User's input message
 */
export async function getCoachReply(text: string): Promise<string> {
    const res = await llm.invoke([
        new SystemMessage("You are a kind, smart fitness coach who guides the user step by step."),
        new HumanMessage(text),
    ]);

    return res.content as string;
}