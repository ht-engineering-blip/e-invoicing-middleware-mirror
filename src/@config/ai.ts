import { z } from 'zod';
import { handleConfigError } from './errors';

const aiConfigSchema = z.object({
  inferenceModel: z.string().default('gpt-4-turbo-preview'),
  openApiEndpoint: z.url(),
  openAIApiKey: z.string()
});

const parseAiConfig = () => {
  try {
    return aiConfigSchema.parse({ 
      openAIApiKey: process.env.OPENAI_API_KEY || "" ,
      openApiEndpoint: process.env.OPENAI_API_ENDPOINT || "" ,
      inferenceModel: process.env.OPENAI_API_MODEL || "" 
    });
  } catch (error) {
    handleConfigError('app', error);
  }
};

export const aiConfig = parseAiConfig();
