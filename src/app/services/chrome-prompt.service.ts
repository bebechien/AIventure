/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Injectable } from '@angular/core';
import { ModelBackend } from './model-backend.interface';

// Declare the experimental API to avoid TypeScript errors
declare var LanguageModel: any;

@Injectable({
  providedIn: 'root'
})
export class ChromePromptService implements ModelBackend {
  private history: string[] = [];
  private session: any = null;

  constructor() {}

  reset(): void {
    this.history = [];
    this.session = null;
  }

  async *generateTextStream(tool_list: string, context: string, prompt: string): AsyncGenerator<string> {
    if (!this.session) {
      try {
        console.log("Creating Chrome Prompt API session...");
        // Using the API specified by the user
        this.session = await LanguageModel.create({ outputLanguage: 'en' });
      } catch (e) {
        console.error("Failed to create Chrome Prompt API session:", e);
        yield "Error: Chrome Prompt API not available or failed to initialize. Ensure you are in a supported browser and flags are enabled.";
        return;
      }
    }

    let fullPrompt = "";
    if (context) {
      fullPrompt += `Context: ${context}\n`;
    }
    if (this.history.length > 0) {
      fullPrompt += `History:\n${this.history.join('\n')}\n`;
    }
    fullPrompt += `User: ${prompt}`;

    try {
      const stream = this.session.promptStreaming(fullPrompt);
      this.history.push(`User: ${prompt}`);
      
      let fullResponse = "";
      for await (const chunk of stream) {
        fullResponse += chunk;
        
        yield chunk;
      }

      console.log(fullResponse);
      
      this.history.push(`Assistant: ${fullResponse}`);
    } catch (e) {
      console.error("Error during prompt streaming:", e);
      yield "Error during text generation.";
    }
  }

  async *generateHtmlStream(prompt: string, previousHtml: string = ""): AsyncGenerator<string> {
    if (!this.session) {
      try {
        this.session = await LanguageModel.create({ outputLanguage: 'en' });
      } catch (e) {
        console.error("Failed to create Chrome Prompt API session:", e);
        yield "Error: Chrome Prompt API not available.";
        return;
      }
    }

    const systemInstruction = `You are an expert web developer. Create a single HTML file containing CSS and JS based on the following request. Return ONLY the raw HTML code.`;
    
    let fullPrompt = `${systemInstruction}\n`;
    if (previousHtml) {
      fullPrompt += `Update the following HTML based on the user's request.\n\nExisting HTML:\n${previousHtml}\n\n`;
    }
    fullPrompt += `Request: ${prompt}`;

    try {
      const stream = this.session.promptStreaming(fullPrompt);
      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (e) {
      console.error("Error during HTML generation:", e);
      yield "Error generating HTML.";
    }
  }
}
