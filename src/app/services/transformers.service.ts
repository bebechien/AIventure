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

import { Injectable, OnDestroy } from '@angular/core';
import { ModelBackend } from './model-backend.interface';
import { pipeline, TextStreamer } from '@huggingface/transformers';
import { BehaviorSubject } from 'rxjs';
import { EventBus } from '../../game/core/EventBus';

@Injectable({
  providedIn: 'root'
})
export class TransformersService implements ModelBackend, OnDestroy {
  private generator: any;
  private tokenizer: any;
  private history: any[] = [];
  private modelName = 'onnx-community/gemma-4-E4B-it-ONNX';

  private initializationPromise: Promise<void> | null = null;

  public loadingProgress$ = new BehaviorSubject<number>(0);
  public loadingStatus$ = new BehaviorSubject<string>('Initializing...');
  public isReady$ = new BehaviorSubject<boolean>(false);

  constructor() {
    EventBus.on('model-tool-execution-result', this.handleToolResult, this);
  }

  ngOnDestroy() {
    EventBus.off('model-tool-execution-result', this.handleToolResult, this);
    this.history = [];
  }

  public reset() {
    this.history = [];
  }

  async handleToolResult(result: any) {
    console.log("TransformersService handleToolResult:", result);
    this.history.push({ role: 'tool', content: JSON.stringify(result.output) });
  }

  public async init() {
    await this.ensureInitialized();
  }

  private handleProgress(args: any) {
    if (args.status === 'progress') {
      this.loadingProgress$.next(args.progress);
      this.loadingStatus$.next(`Downloading ${args.file}...`);
    } else if (args.status === 'done') {
      this.loadingStatus$.next(`Finished ${args.file}`);
    } else if (args.status === 'ready') {
      this.loadingStatus$.next('Model ready');
      this.isReady$.next(true);
    }
  }

  private ensureInitialized() {
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      console.log('Initializing transformers.js pipeline...');
      try {
        // Use a chat-tuned model
        this.generator = await pipeline('text-generation', this.modelName, {
          device: 'webgpu',
          dtype: 'q4',
          progress_callback: (x: any) => this.handleProgress(x)
        });
        this.tokenizer = this.generator.tokenizer;
        console.log('transformers.js pipeline initialized.');
        this.isReady$.next(true);
      } catch (error) {
        console.error('Failed to initialize transformers.js:', error);
        this.loadingStatus$.next('Failed to load model');
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  async *generateTextStream(tool_list: string, context: string, prompt: string): AsyncGenerator<string> {
    await this.ensureInitialized();

    const messages = [];
    
    let systemPrompt = "";
    if (context) {
      systemPrompt = `Context: ${context}`;
    }
    
    if (tool_list) {
      try {
        const tools = JSON.parse(tool_list);
        if (tools.length > 0) {
          systemPrompt += "\n\n";
          for (const tool of tools) {
            const declaration = this.formatGemma4Declaration(tool);
            systemPrompt += declaration;
          }
        }
      } catch (e) {
        console.warn("Failed to parse tools in TransformersService:", e);
      }
    }

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push(...this.history);
    messages.push({ role: 'user', content: prompt });

    this.history.push({ role: 'user', content: prompt });

    const queue: string[] = [];
    let signal: () => void;
    let promise = new Promise<void>(r => signal = r);
    let isDone = false;
    let error: any = null;

    const pushToQueue = (text: string) => {
      queue.push(text);
      signal();
    };

    let fullResponse = "";

    const streamer = new TextStreamer(this.tokenizer, {
      skip_prompt: true,
      callback_function: (text: string) => {
        pushToQueue(text);
        fullResponse += text;
      }
    });

    this.generator(messages, {
      max_new_tokens: 512,
      do_sample: true,
      streamer: streamer,
      return_full_text: false
    }).then((output: any) => {
      isDone = true;
      // If fullResponse is still empty, try to fallback to output
      if (!fullResponse && Array.isArray(output) && output.length > 0) {
          let genText = output[0].generated_text;
          if (typeof genText === 'object') {
             genText = (genText as any).content || "";
          }
          fullResponse = genText;
      }
      
      // Check for Gemma 4 tool calls
      // Support both tag-wrapped and raw formats
      console.log('TransformersService fullResponse:', fullResponse);
      const toolCallRegex = /(?:<\|tool_call>)?call:(\w+)\{(.*?)\}(?:<tool_call|>)?/g;
      let match;
      let foundToolCall = false;

      while ((match = toolCallRegex.exec(fullResponse)) !== null) {
        console.log('Found tool call match:', match[0]);
        foundToolCall = true;
        const name = match[1];
        const argsStr = match[2];
        
        const argumentsObj: any = {};
        const argRegex = /(\w+):(?:<\|"\|>(.*?)<\|"\|>|([^,}]*))/g;
        let argMatch;
        while ((argMatch = argRegex.exec(argsStr)) !== null) {
          const k = argMatch[1];
          const v1 = argMatch[2];
          const v2 = argMatch[3];
          
          let val: any = v1 || v2;
          if (val !== undefined) {
            val = val.trim();
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (!isNaN(val) && val !== '') val = Number(val);
            argumentsObj[k] = val;
          }
        }

        EventBus.emit('model-function-call', { name, args: argumentsObj });
        pushToQueue(`\nFunction call: ${name}`);
      }

      this.history.push({ role: 'assistant', content: fullResponse });
      signal();
    }).catch((err: any) => {
      error = err;
      isDone = true;
      signal();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (isDone) {
        break;
      } else if (error) {
        throw error;
      } else {
        await promise;
        promise = new Promise<void>(r => signal = r);
      }
    }
  }

  private formatGemma4Declaration(tool: any): string {
    const name = tool.name;
    const desc = tool.description;
    const params = tool.parameters;

    let result = `<|tool>declaration:${name}{`;
    if (desc) {
      result += `description:<|"|>${desc}<|"|>,`;
    }
    if (params) {
      result += `parameters:${this.formatGemma4Object(params)}`;
    }
    result += `}<tool|>`;
    return result;
  }

  private formatGemma4Object(obj: any): string {
    let result = "{";
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = obj[key];
      result += `${key}:`;
      
      if (key === 'type' && typeof val === 'string') {
        result += `<|"|>${val.toUpperCase()}<|"|>`;
      } else if (typeof val === 'string') {
        result += `<|"|>${val}<|"|>`;
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        result += this.formatGemma4Object(val);
      } else if (Array.isArray(val)) {
        result += `[${val.map(v => typeof v === 'string' ? `<|"|>${v}<|"|>` : v).join(',')}]`;
      } else {
        result += val;
      }
      
      if (i < keys.length - 1) {
        result += ",";
      }
    }
    result += "}";
    return result;
  }

  async *generateHtmlStream(prompt: string, previousHtml: string = ""): AsyncGenerator<string> {
    await this.ensureInitialized();

    const systemInstruction = `You are an expert web developer. Create a single HTML file containing CSS and JS based on the following request. Return ONLY the raw HTML code.`;

    let fullPrompt = "";
    if (previousHtml) {
        fullPrompt = `Update the following HTML based on the user's request.\n\nExisting HTML:\n${previousHtml}\n\nRequest: ${prompt}`;
    } else {
        fullPrompt = `Request: ${prompt}`;
    }

    const messages = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: fullPrompt }
    ];

    const queue: string[] = [];
    let signal: () => void;
    let promise = new Promise<void>(r => signal = r);
    let isDone = false;
    let error: any = null;

    const pushToQueue = (text: string) => {
      queue.push(text);
      signal();
    };

    const streamer = new TextStreamer(this.tokenizer, {
      skip_prompt: true,
      callback_function: (text: string) => {
        pushToQueue(text);
      }
    });

    this.generator(messages, {
      max_new_tokens: 1024,
      do_sample: false,
      streamer: streamer,
      return_full_text: false
    }).then(() => {
      isDone = true;
      signal();
    }).catch((err: any) => {
      error = err;
      isDone = true;
      signal();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (isDone) {
        break;
      } else if (error) {
        throw error;
      } else {
        await promise;
        promise = new Promise<void>(r => signal = r);
      }
    }
  }
}
