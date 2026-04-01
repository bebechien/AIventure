import { Injectable, OnDestroy } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { EventBus } from '../../game/core/EventBus';
import { environment } from '../../environments/environment';
import { FunctionCallObject, CodeSnippetObject } from './model-types';
import { ModelBackend } from './model-backend.interface';

interface Part {
  text?: string;
  functionCall?: any;
  functionResponse?: {
    name: string;
    response: { result: any };
  };
}

interface Content {
  role: 'user' | 'model' | 'tool';
  parts: Part[];
}

// [START solution_code]

@Injectable({
  providedIn: 'root'
})
export class GeminiService implements ModelBackend, OnDestroy {
  private ai: GoogleGenAI;
  private history: Content[] = [];
  private lastTool: string = "[]";

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: environment.GEMINI_API_KEY });
    EventBus.on('model-tool-execution-result', this.handleToolResult, this);
  }

  ngOnDestroy() {
    EventBus.off('model-tool-execution-result', this.handleToolResult, this);
  }

  public reset() {
    this.history = [];
    this.lastTool = "[]";
  }

  // [END solution_code]

  private constructToolList(tool_list: string) {
    if (tool_list) {
      try {
        let functionObjs = JSON.parse(tool_list);
        return [{
          functionDeclarations: functionObjs,
        }];
      } catch (e) {
        console.warn("Failed to parse context for tools:", e);
      }
    }
    return [];
  }

  private async processStreamResponse(response: any): Promise<void> {
    let fullText = "";
    let functionCalls: any[] = [];

    try {
      for await (const chunk of response) {
        if (chunk.text) {
          fullText += chunk.text;
          console.log(`Gemini: ${chunk.text}`)
        }
        if (chunk.functionCalls) {
          const tool_call = chunk.functionCalls[0];
          EventBus.emit('model-function-call', tool_call);
          functionCalls.push(tool_call);
        }
      }

      let modelParts: Part[] = [];
      if (fullText) modelParts.push({ text: fullText });
      if (functionCalls.length > 0) {
        functionCalls.forEach(fc => modelParts.push({ functionCall: fc }));
      }

      if (modelParts.length > 0) {
        this.history.push({ role: 'model', parts: modelParts });
      }
    } catch (error) {
      console.error('Error processing stream:', error);
      throw error;
    }
  }

  async handleToolResult(result: any) {
    const functionResponsePart: Part = {
      functionResponse: {
        name: result.name,
        response: { result: result.output }
      }
    };

    this.history.push({ role: 'tool', parts: [functionResponsePart] });

    try {
      const response = await this.ai.models.generateContentStream({
        model: 'gemini-flash-lite-latest',
        config: {
          tools: this.constructToolList(this.lastTool)
        },
        contents: this.history
      });

      await this.processStreamResponse(response);
    } catch (error) {
      console.error('Error in handleToolResult:', error);
    }
  }

  async *generateTextStream(tool_list: string, context: string, prompt: string) {
    this.lastTool = tool_list;

    if (this.ai['apiKey'] === 'GEMINI_API_KEY') {
      const result = this.fallbackGeneration(tool_list, context, prompt);
      if (result instanceof FunctionCallObject) {
        EventBus.emit('model-function-call', result);
        yield `Function call: ${result.name}`;
      } else if (result instanceof CodeSnippetObject) {
        EventBus.emit('model-code-generated', result.code);
        yield `Generated code snippet.`;
      } else {
        yield result;
      }
      return;
    }

    if (context) {
      this.history.push({ role: 'user', parts: [{ text: `Context: ${context}\nUser: ${prompt}` }] });
    } else {
      this.history.push({ role: 'user', parts: [{ text: prompt }] });
    }

    try {
      const response = await this.ai.models.generateContentStream({
        model: 'gemini-flash-lite-latest',
        config: {
          tools: this.constructToolList(tool_list)
        },
        contents: this.history,
      });

      // We duplicate the iteration logic here because we need to YIELD to the caller.
      // The `processStreamResponse` helper doesn't yield.
      // Ideally, we'd refactor the caller to just use the EventBus events, 
      // but `ChatInputComponent` expects a stream of strings.
      
      let fullText = "";
      let functionCalls: any[] = [];

      for await (const chunk of response) {
        if (chunk.functionCalls) {
          const tool_call = chunk.functionCalls[0];
          EventBus.emit('model-function-call', tool_call)
          functionCalls.push(tool_call);
          yield `Function call: ${tool_call.name}`;
        } else if (chunk.text){
          fullText += chunk.text;
          yield chunk.text;
        }
      }

      // Update history after stream completes
      let modelParts: Part[] = [];
      if (fullText) modelParts.push({ text: fullText });
      if (functionCalls.length > 0) {
        functionCalls.forEach(fc => modelParts.push({ functionCall: fc }));
      }

      if (modelParts.length > 0) {
        this.history.push({ role: 'model', parts: modelParts });
      }

    } catch (error) {
      console.error('Error generating streaming text:', error);
      throw error;
    }
  }

  // Fallback logic for when no real API key is present
  private fallbackGeneration(tool_list: string, context: string, prompt: string) {
    const fc_obj = new FunctionCallObject();
    let calling = "";
    const p = prompt.toLowerCase();
    
    if (p.includes("open ")) {
      calling = "open_";
      if (p.includes(" red")) calling += "red_door";
      else if (p.includes(" blue")) calling += "blue_door";
      else if (p.includes(" yellow")) calling += "yellow_door";
      else if (p.includes(" green")) calling += "green_door";
    } else if (p.includes("light ")) {
      calling = "light_"
      if (p.includes(" on")) calling += "on";
      else if (p.includes(" off")) calling += "off";
    } else if (p.includes("what's the code?")) {
      if (context.includes("8452")) {
        return "The code is 8452!";
      }
      else {
        return "I don't know the code.";
      }
    } else if (p.includes(" code")) {
      const codeObj = new CodeSnippetObject();
      codeObj.code = "return 5050;";
      return codeObj;
    }

    if (calling && tool_list.includes(calling)) {
      fc_obj.name = calling;
      return fc_obj;
    }
    return "Hello!";
  }

  async *generateHtmlStream(prompt: string, previousHtml: string = ""): AsyncGenerator<string> {
    if (this.ai['apiKey'] === 'GEMINI_API_KEY') {
        yield `
        <html>
        <head>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f0f0; }
                .box { padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #333; }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>Mock HTML for: ${prompt}</h1>
                <p>This is a placeholder because no API Key is set.</p>
                ${previousHtml ? '<p><i>(Context was provided)</i></p>' : ''}
            </div>
        </body>
        </html>
        `;
        return;
    }

    try {
        let systemInstruction = `You are an expert web developer. Create a single HTML file containing CSS and JS based on the following request. Return ONLY the raw HTML code, no markdown formatting (no \`\`\`html wrapper).`;
        
        if (previousHtml) {
            systemInstruction += `\n\nUpdate the following HTML based on the user's request. Return the FULL updated HTML file.\n\nExisting HTML:\n${previousHtml}`;
        }

        const response = await this.ai.models.generateContentStream({
            model: 'gemini-flash-lite-latest',
            contents: [{
                role: 'user',
                parts: [{ text: `${systemInstruction}\n\nRequest: ${prompt}` }]
            }]
        });
        
        for await (const chunk of response) {
            if (chunk.text) {
                yield chunk.text;
            }
        }

    } catch (e) {
        console.error("Error generating HTML:", e);
        yield "<html><body><h1>Error generating HTML</h1></body></html>";
    }
  }
}
