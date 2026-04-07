// [START solution_code]

import { Injectable, OnDestroy } from '@angular/core';
import { EventBus } from '../../game/core/EventBus';
import { ModelBackend } from './model-backend.interface';
import { LogService } from './log.service';

@Injectable({
  providedIn: 'root'
})
export class LmStudioService implements ModelBackend, OnDestroy {
  private history: any[] = [];
  private apiUrl = 'http://localhost:1234/v1/chat/completions';
  private model = 'google/gemma-4-e4b-it'; // LM Studio usually accepts any string here if one model is loaded
  private lastTool: string = "[]";
  private waitingToolCallCount = 0;

    // [END solution_code]

  constructor(private logService: LogService) {
    EventBus.on('model-tool-execution-result', this.handleToolResult, this);
  }

  ngOnDestroy() {
    EventBus.off('model-tool-execution-result', this.handleToolResult, this);
  }

  public reset() {
    this.history = [];
    this.lastTool = "[]";
    this.waitingToolCallCount = 0;
  }

  private constructTools(tool_list: string) {
    if (!tool_list) return undefined;

    try {
      let functionObjs = JSON.parse(tool_list);
      if (functionObjs.length === 0) return undefined;

      return functionObjs.map((obj: any) => ({
        type: 'function',
        function: obj
      }));
    } catch (e) {
      console.warn("Failed to parse context for tools:", e);
    }
    return undefined;
  }

  private constructRequestBody(tool_list: string) {
    const requestBody: any = {
      model: this.model,
      messages: this.history,
      stream: true
    };

    const tools = this.constructTools(tool_list);
    if (tools) {
      requestBody.tools = tools;
    }
    return JSON.stringify(requestBody);
  }

    // [START tool_code]
  async handleToolResult(result: any) {
    // If we don't have a pending tool call ID, we can't properly respond in OpenAI format.
    // However, we can try to proceed or just log a warning.
    // In sequential execution, currentToolCallId should be set from the previous turn.

    const lastMessage = this.history.at(-1);
    const callTarget = lastMessage.tool_calls.at(-this.waitingToolCallCount);
    console.log(callTarget);
    lastMessage.tool_responses ??= [];
    lastMessage.tool_responses.push({
        name: callTarget.function.name,
        response: JSON.stringify(result.output),
    });
    console.log(lastMessage.tool_responses.at(-1));

    this.waitingToolCallCount--;
    if (this.waitingToolCallCount > 0) return;
    console.log("All tools processed. History:", this.history);

    try {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: this.constructRequestBody(this.lastTool)
        });

        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let accumulatedContent = "";
        let currentToolCall: any = null;
        let toolCalls: any[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                
                const dataStr = trimmed.substring(6);
                if (dataStr === '[DONE]') break;

                try {
                    const json = JSON.parse(dataStr);
                    const choice = json.choices[0];
                    
                    if (choice.delta) {
                        const delta = choice.delta;

                        if (delta.content) {
                            if (accumulatedContent === "") {
                                this.logService.addLog(`LMStudio: ${delta.content}`);
                            } else {
                                this.logService.appendLog(delta.content);
                            }
                            accumulatedContent += delta.content;
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.id) {
                                    if (currentToolCall) toolCalls.push(currentToolCall);
                                    currentToolCall = {
                                        id: tc.id,
                                        type: tc.type || 'function',
                                        function: {
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || ''
                                        }
                                    };
                                } else if (currentToolCall) {
                                    if (tc.function?.arguments) {
                                        currentToolCall.function.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        }
                    }

                    if (choice.finish_reason) {
                        if (currentToolCall) {
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }

                        const finalMsg: any = { role: 'assistant', content: accumulatedContent || null };
                        if (toolCalls.length > 0) {
                            finalMsg.tool_calls = toolCalls;
                        }
                        this.history.push(finalMsg);
                        this.waitingToolCallCount = toolCalls.length;
                        if (toolCalls.length > 0) {
                            toolCalls.forEach((tc: any) => {
                                 const functionCall = {
                                     name: tc.function.name,
                                     args: tc.function.arguments 
                                 };
                                 try { functionCall.args = JSON.parse(functionCall.args); } catch (e) {}
                                 EventBus.emit('model-function-call', functionCall);
                             });
                        }

                    }
                } catch (e) {
                    console.error("Error parsing LM Studio chunk", e);
                }
            }
        }

    } catch (e) {
        console.error("Error in handleToolResult", e);
    }
  }
    // [END tool_code]

  async *generateTextStream(tool_list: string, context: string, prompt: string): AsyncGenerator<string> {
    this.lastTool = tool_list;

    let userMessage = prompt;
    if (context) {
        userMessage = `Context: ${context}\nUser: ${prompt}`;
    }

    this.history.push({ role: 'user', content: userMessage });

    try {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: this.constructRequestBody(tool_list)
        });

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let accumulatedContent = "";
        let currentToolCall: any = null;
        let toolCalls: any[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                
                const dataStr = trimmed.substring(6); // Remove 'data: '
                if (dataStr === '[DONE]') break;

                try {
                    const json = JSON.parse(dataStr);
                    const choice = json.choices[0];
                    
                    if (choice.delta) {
                        const delta = choice.delta;

                        // Handle Content
                        if (delta.content) {
                            accumulatedContent += delta.content;
                            yield delta.content;
                        }

                        // Handle Tool Calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.id) {
                                    // New tool call starting
                                    if (currentToolCall) {
                                        toolCalls.push(currentToolCall);
                                    }
                                    currentToolCall = {
                                        id: tc.id,
                                        type: tc.type || 'function',
                                        function: {
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || ''
                                        }
                                    };
                                } else if (currentToolCall) {
                                    // Appending to current tool call
                                    if (tc.function?.arguments) {
                                        currentToolCall.function.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        }
                    }

                    if (choice.finish_reason) {
                        // If there's a pending tool call, push it
                        if (currentToolCall) {
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }

                        const finalMsg: any = { role: 'assistant', content: accumulatedContent || null };
                        
                        if (toolCalls.length > 0) {
                            finalMsg.tool_calls = toolCalls;
                             for (const tc of toolCalls) {
                                yield `Function call: ${tc.function.name}`;
                             }
                        }
                        this.history.push(finalMsg);
                        this.waitingToolCallCount = toolCalls.length;
                        if (toolCalls.length > 0) {
                            toolCalls.forEach((tc: any) => {
                                 const functionCall = {
                                     name: tc.function.name,
                                     args: tc.function.arguments 
                                 };
                                 try { functionCall.args = JSON.parse(functionCall.args); } catch (e) {}
                                 EventBus.emit('model-function-call', functionCall);
                             });
                        }

                    }

                } catch (e) {
                    console.error("Error parsing LM Studio chunk", e);
                }
            }
        }
    } catch (e) {
        console.error("Error generating text stream", e);
        yield "Error connecting to LM Studio.";
    }
  }

  async *generateHtmlStream(prompt: string, previousHtml: string = ""): AsyncGenerator<string> {
    let systemInstruction = `You are an expert web developer. Create a single HTML file containing CSS and JS based on the following request. Return ONLY the raw HTML code, no markdown formatting (no \`\`\`html wrapper).`;

    if (previousHtml) {
        systemInstruction += `\n\nUpdate the following HTML based on the user's request. Return the FULL updated HTML file.\n\nExisting HTML:\n${previousHtml}`;
    }

    try {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt }
                ],
                stream: true
            })
        });

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                
                const dataStr = trimmed.substring(6);
                if (dataStr === '[DONE]') break;

                try {
                    const json = JSON.parse(dataStr);
                    const content = json.choices[0]?.delta?.content;
                    if (content) {
                        yield content;
                    }
                } catch (e) {
                    console.error("Error parsing LM Studio chunk", e);
                }
            }
        }
    } catch (e) {
        console.error("Error generating HTML:", e);
        yield "<html><body><h1>Error generating HTML</h1></body></html>";
    }
  }
}