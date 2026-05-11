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

import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { MODEL_BACKEND } from './services/model-token';
import { GeminiService } from './services/gemini.service';
import { OllamaService } from './services/ollama.service';
import { LmStudioService } from './services/lmstudio.service';
import { TransformersService } from './services/transformers.service';
import { ChromePromptService } from './services/chrome-prompt.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    // { provide: MODEL_BACKEND, useClass: GeminiService }, // Default, no need to specify if providedIn: 'root' works, but good to have explicit
    // { provide: MODEL_BACKEND, useClass: OllamaService }, // Uncomment to use Ollama
    // { provide: MODEL_BACKEND, useClass: LmStudioService }, // Uncomment to use LM Studio
    { provide: MODEL_BACKEND, useClass: TransformersService }, // Uncomment to use transformers.js
    // { provide: MODEL_BACKEND, useClass: OnyxGemmaService }, // Uncomment to use Onyx Gemma
    // { provide: MODEL_BACKEND, useClass: ChromePromptService } // Uncomment to use Chrome Prompt API
  ]
};
