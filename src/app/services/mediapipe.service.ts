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
import { BehaviorSubject } from 'rxjs';
import { EventBus } from '../../game/core/EventBus';
import JSON5 from 'json5';

interface ToolResponse {
  name: string;
  output: any;
}

interface Message {
  role: 'user' | 'model' | 'system' | 'tool';
  content: string | ToolResponse;
}

//[START solution_code]
@Injectable({
  providedIn: 'root'
})
export class MediaPipeService implements ModelBackend, OnDestroy {
  private llmInference: any = null;
  private history: Message[] = [];
  private lastTool: string = "[]";
  
  private initializationPromise: Promise<void> | null = null;
  private localModelUrl = '/assets/models/gemma-4-E4B-it-web.task';
  // Pinned to immutable commit SHA on Hugging Face instead of mutable 'main' branch
  private remoteModelUrl = 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it-web.task';

  //[END solution_code]

  public loadingProgress$ = new BehaviorSubject<number>(0);
  public loadingStatus$ = new BehaviorSubject<string>('Initializing...');
  public isReady$ = new BehaviorSubject<boolean>(false);

  constructor() {
    EventBus.on('model-tool-execution-result', this.handleToolResult, this);
  }

  ngOnDestroy() {
    EventBus.off('model-tool-execution-result', this.handleToolResult, this);
  }

  public reset() {
    this.history = [];
    this.lastTool = "[]";
  }

  private async *generateLlmStream(prompt: string): AsyncGenerator<string> {
    const queue: string[] = [];
    let signal: () => void;
    let promise = new Promise<void>(r => signal = r);
    let isDone = false;
    let error: any = null;

    const pushToQueue = (text: string) => {
      queue.push(text);
      signal();
    };

    this.llmInference.generateResponse(
      prompt,
      (partialResult: string, done: boolean) => {
        if (partialResult) {
          pushToQueue(partialResult);
        }
        if (done) {
          isDone = true;
          signal();
        }
      }
    ).catch((err: any) => {
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

  private parseToolCalls(text: string): void {
    const toolCallRegex = /call:(\w+)\{(.*?)\}/g;
    let match;
    while ((match = toolCallRegex.exec(text)) !== null) {
      const name = match[1];
      const argsStr = match[2];
      let args = {};
      if (argsStr.trim()) {
        try {
          args = JSON5.parse(`{${argsStr}}`);
        } catch (e) {
          console.warn(`MediaPipeService: failed to parse args for ${name}`, e);
        }
      }
      console.log(`MediaPipeService: parsed pseudo-tool-call: ${name}`, args);
      EventBus.emit('model-function-call', { name, args });
    }
  }

  async handleToolResult(result: any) {
    console.log("MediaPipeService handleToolResult:", result);
    
    const toolRes: ToolResponse = { name: result.name, output: result.output };
    console.log(this.history);
    this.history.push({ role: 'tool', content: toolRes });

    const fullPrompt = this.buildFullPrompt(this.lastTool, this.history);
    console.log("MediaPipeService handleToolResult Prompt:", fullPrompt);

    let fullResponse = "";
    for await (const chunk of this.generateLlmStream(fullPrompt)) {
      fullResponse += chunk;
    }

    this.history.push({ role: 'model', content: fullResponse });
    this.parseToolCalls(fullResponse);
  }

  private buildFullPrompt(toolList: string, history: Message[]): string {
    let fullPrompt = this.constructSystemPrompt(toolList);

    let after_tool = false;
    for (const msg of history) {
      if (msg.role === 'tool') {
        after_tool = true;
        const toolRes = msg.content as ToolResponse;
        const turn_suffix: string = `<turn|>\n`;
        const tool_suffix: string = `<|tool_response>`;
        if (fullPrompt.endsWith(turn_suffix)) {
          fullPrompt = fullPrompt.slice(0, -turn_suffix.length);
        }
        if (fullPrompt.endsWith(tool_suffix)) {
          fullPrompt = fullPrompt.slice(0, -tool_suffix.length);
        }
        fullPrompt += `<|tool_response>response:${toolRes.name}{${this.customStringify(toolRes.output)}}<tool_response|>`;
      } else {
        if (after_tool) {
          fullPrompt += `${msg.content}<turn|>\n`;
          after_tool = false;
        }
        else {
          fullPrompt += `<|turn>${msg.role}\n${msg.content}<turn|>\n`;
        }
      }
    }

    return fullPrompt;
  }

  public async init() {
    await this.ensureInitialized();
  }

  // Helper function to recursively format the object
  private customStringify(val: any): string {
    if (val === null) return 'null';

    // Strings get wrapped in the custom token instead of double quotes
    if (typeof val === 'string') {
      return `<|"|>${val}<|"|>`;
    }

    // Numbers and booleans are returned as plain strings
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }

    // Arrays recursively format each item
    if (Array.isArray(val)) {
      const items = val.map(item => this.customStringify(item)).join(',');
      return `[${items}]`;
    }

    // Objects iterate keys (outputting them bare) and recursively format values
    if (typeof val === 'object') {
      const entries = Object.entries(val)
        // Ignore undefined values just like native JSON.stringify does
        .filter(([_, value]) => value !== undefined) 
        .map(([key, value]) => `${key}:${this.customStringify(value)}`)
        .join(',');
      return `{${entries}}`;
    }

    return '';
  }

  private ensureInitialized(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      console.log('Initializing MediaPipe GenAI Tasks with FileProxyCache...');
      this.loadingStatus$.next('Loading helper libraries...');
      this.loadingProgress$.next(10);

      try {
        // Dynamic ESM imports from CDNs pinned to exact versions to prevent supply-chain drift
        // Note: Update these pinned versions (1.0.4 and 0.10.26) deliberately after auditing new releases.
        // @ts-ignore
        const cacheModule = await import('https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@1.0.4/FileProxyCache.min.js');
        const FileProxyCache = cacheModule.default;

        // @ts-ignore
        const genaiModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.26/+esm');
        const FilesetResolver = genaiModule.FilesetResolver;
        const LlmInference = genaiModule.LlmInference;

        this.loadingStatus$.next('Resolving model cache...');
        this.loadingProgress$.next(20);

        const progressCallback = (textUpdate: string) => {
          this.loadingStatus$.next(textUpdate);
          const pctMatch = textUpdate.match(/(\d+(?:\.\d+)?)\s*%/);
          if (pctMatch) {
            const pct = parseFloat(pctMatch[1]);
            // Map 0-100% download progress to 20% to 80% in overall progress
            const overallPct = 20 + Math.round((pct / 100) * 60);
            this.loadingProgress$.next(overallPct);
          }
        };

        let dataUrl: string | null = null;
        try {
          // 1. Attempt to resolve model locally
          console.log('Checking local model cache URL:', this.localModelUrl);
          dataUrl = await FileProxyCache.loadFromURL(this.localModelUrl, progressCallback);
        } catch (err) {
          console.warn('Local model file check skipped, falling back to remote GCP bucket:', err);
        }

        // 2. Fallback to Google Storage bucket
        if (!dataUrl) {
          console.log('Fetching remote model cache from GCP bucket:', this.remoteModelUrl);
          dataUrl = await FileProxyCache.loadFromURL(this.remoteModelUrl, progressCallback);
        }

        if (!dataUrl) {
          throw new Error('Failed to fetch model from local or remote GCP cache buckets.');
        }

        this.loadingStatus$.next('Loading fileset resolver...');
        this.loadingProgress$.next(85);

        const genai = await FilesetResolver.forGenAiTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.26/wasm"
        );

        this.loadingStatus$.next('Creating LlmInference session on GPU...');
        this.loadingProgress$.next(95);

        this.llmInference = await LlmInference.createFromOptions(genai, {
          baseOptions: {
            modelAssetPath: dataUrl
          },
          maxTokens: 8192,
          topK: 64,
          temperature: 0.95
        });

        console.log('MediaPipe LlmInference initialized successfully.');
        this.loadingStatus$.next('Ready');
        this.loadingProgress$.next(100);
        this.isReady$.next(true);
      } catch (error: any) {
        console.error('Failed to initialize MediaPipe GenAI tasks:', error);
        this.loadingStatus$.next('Failed to load Web AI model weights.');
        this.loadingProgress$.next(0);
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  private constructSystemPrompt(tool_list: string) {
    let systemPrompt = "";

    if (tool_list && tool_list !== "[]") {
      try {
        const parsedTools = JSON.parse(tool_list);
        if (parsedTools.length > 0) {
          const toolsInfo = parsedTools.map((t: any) => {
            const parameterStr = t.parameters ? `,parameters:${this.customStringify(t.parameters)}` : '';
            return `<|tool>declaration:${t.name}{description:<|"|>${t.description}<|"|>${parameterStr}}<tool|>`;
          }).join('');

          systemPrompt = `<|turn>system\nYou are a helpful assistant in a web adventure game. You have access to the following tools:\n${toolsInfo}<turn|>\n`;
        }
      } catch (err) {
        console.warn("Failed to parse tool list inside MediaPipeService:", err);
      }
    }

    return systemPrompt;
  }

  async *generateTextStream(tool_list: string, context: string, prompt: string): AsyncGenerator<string> {
    await this.ensureInitialized();

    this.lastTool = tool_list;

    const userMessage = context ? `Context: ${context}\n${prompt?'User: '+prompt:''}` : prompt;
    this.history.push({ role: 'user', content: userMessage });

    const fullPrompt = this.buildFullPrompt(tool_list, this.history) + `<|turn>model\n`;
    console.log("MediaPipeService generateTextStream Prompt:", fullPrompt);

    let fullResponse = "";
    let isPartial: boolean = false;
    let isSkipping: boolean = false;

    const start_tool_call: string = "<|tool_call>";
    const end_tool_call: string = "<tool_call|>";
    const start_tool_response: string = "<|tool_response>";
    const end_tool_response: string = "<tool_response|>";
    for await (let chunk of this.generateLlmStream(fullPrompt)) {
      fullResponse += chunk;
      if (!isSkipping) {
        const startCallIdx = chunk.indexOf(start_tool_call);
        const startResponseIdx = chunk.indexOf(start_tool_response);
        if (startCallIdx !== -1) {
          isSkipping = true;
          isPartial = true;
          chunk = chunk.slice(0, startCallIdx);
        } else if (startResponseIdx !== -1) {
          isSkipping = true;
          isPartial = true;
          chunk = chunk.slice(0, startResponseIdx);
        }
      } else {
        const endCallIdx = chunk.indexOf(end_tool_call);
        const endResponseIdx = chunk.indexOf(end_tool_response);
        if (endCallIdx !== -1) {
          isSkipping = false;
          chunk = chunk.slice(endCallIdx + end_tool_call.length);
          const startResponseIdx = chunk.indexOf(start_tool_response);
          if (startResponseIdx !== -1) {
            isSkipping = true;
            isPartial = true;
            chunk = chunk.slice(0, startResponseIdx);
          }
        } else if (endResponseIdx !== -1) {
          isSkipping = true;
          chunk = chunk.slice(endResponseIdx + end_tool_response.length);
        }
      }
      if (isSkipping) {
        if (isPartial) {
          isPartial = false;
          yield chunk;
        }
      } else {
        yield chunk;
      }
    }

    console.log("MediaPipeService Response:", fullResponse);
    this.history.push({ role: 'model', content: fullResponse });
    this.parseToolCalls(fullResponse);
  }

  async *generateHtmlStream(prompt: string, previousHtml: string = ""): AsyncGenerator<string> {
    await this.ensureInitialized();

    const systemInstruction = `You are an expert web developer. Create a single HTML file containing CSS and JS based on the following request. Return ONLY the raw HTML code.`;
    
    let fullPrompt = `<|turn>system\n${systemInstruction}<turn|>\n<|turn>user\n`;
    if (previousHtml) {
      fullPrompt += `Update the following HTML based on the user's request.\n\nExisting HTML:\n${previousHtml}\n\n`;
    }
    fullPrompt += `Request: ${prompt}<turn|>\n<|turn>model\n`;

    console.log("MediaPipeService generateHtmlStream Prompt:", fullPrompt);

    for await (const chunk of this.generateLlmStream(fullPrompt)) {
      yield chunk;
    }
  }
}
