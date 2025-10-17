import { Mastra } from '@mastra/core';
import { contentAgent } from './agent.js';

export const mastra = new Mastra({
  agents: { contentAgent },
});
