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

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LogService } from '../../services/log.service';
import { MODEL_BACKEND } from '../../services/model-token';
import { ModelBackend } from '../../services/model-backend.interface';
import { EventBus } from '../../../game/core/EventBus';
import { CodeExecutor } from './right-panel.worker';
import { DevsiteAPI } from '../../services/devsite-api';

type Tab = 'code' | 'iframe' | 'logs';

@Component({
  selector: 'app-right-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './right-panel.component.html',
  styleUrl: './right-panel.component.css'
})
export class RightPanelComponent implements OnInit, OnDestroy {
  @ViewChild('codeEditor') codeEditor!: ElementRef;
  @ViewChild('iframeCodeEditor') iframeCodeEditor!: ElementRef;
  activeTab: Tab = 'code';
  logs: string[] = [];
  collectiblesTracker: Record<string, { count: number; max: number }> = {};
  
  currentCodeInteraction: any = null;
  codeContent: string = '// No code interaction visible';
  isCodeDirty: boolean = false;
  executionResult: string = '';

  // Build Interaction
  currentBuildInteraction: any = null;
  safeHtmlContent: SafeHtml | null = null;
  rawHtml: string = '';
  isBuilding: boolean = false;
  isCreditsVisible: boolean = false;
  iframeSubTab: 'preview' | 'code' = 'preview';

  openCredits()
  {
    this.isCreditsVisible = true;
  }

  closeCredits()
  {
    this.isCreditsVisible = false;
  }

  openGitHub()
  {
    window.open('https://github.com/FirebaseExtended/solution-aiventure', '_blank');
  }

  onCodeChange() {
    this.isCodeDirty = true;
  }

  constructor(
    private logService: LogService,
    private sanitizer: DomSanitizer,
    @Inject(MODEL_BACKEND) private modelService: ModelBackend,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.logService.logs$.subscribe(logs => {
      this.logs = logs;
    });

    EventBus.on('collectibles-tracker', (tracker: any) => {
      this.collectiblesTracker = tracker;
      this.cdr.detectChanges(); // Force update if needed
    });

    EventBus.on('collectible-collected', (data: { name: string }) => {
      if (data.name.toLowerCase() === 'diamond') {
        const badgeData = { url: 'https://developer.google.com/badges/diamond' };
        
        DevsiteAPI.awardBadge('diamond', badgeData, (success) => {
           console.log('Award badge success:', success);
        });
      }
    });

    EventBus.on('game-focused', () => {
      if (this.codeEditor) {
        this.codeEditor.nativeElement.blur();
      }
    });

    EventBus.on('visible-code-interaction', (interaction: any) => {
      this.currentCodeInteraction = interaction;
      if (interaction) {
        this.codeContent = interaction.code || '// Write your code here\nreturn 0;';
        this.isCodeDirty = false; // Reset when new puzzle loads
        this.setActiveTab('code');
      } else {
        this.codeContent = '// No code interaction visible';
        this.isCodeDirty = false;
      }
    });

    EventBus.on('visible-build-interaction', (interaction: any) => {
        const previousHtml = this.currentBuildInteraction?.html;
        this.modelService.reset();

        if (interaction) {
            this.currentBuildInteraction = interaction;
            this.setActiveTab('iframe');

            const htmlToUse = previousHtml || interaction.html;
            this.currentBuildInteraction.html = htmlToUse;

            if (htmlToUse) {
                 this.safeHtmlContent = this.sanitizer.bypassSecurityTrustHtml(htmlToUse);
                 this.rawHtml = htmlToUse;
            } else {
                 this.rawHtml = '';
            }
        }
    });

    EventBus.on('build-html-request', (prompt: string) => {
        this.buildHtml(prompt);
    });

    EventBus.on('model-code-generated', (code: string) => {
      if (this.currentCodeInteraction) {
        this.codeContent = code;
      }
    });

    EventBus.on('request-code-context', this.provideCodeContext, this);
  }

  provideCodeContext() {
    EventBus.emit('provide-code-context', this.codeContent);
  }

  ngOnDestroy() {
      EventBus.off('visible-code-interaction');
      EventBus.off('collectibles-tracker');
      EventBus.off('collectible-collected');
      EventBus.off('visible-build-interaction');
      EventBus.off('build-html-request');
      EventBus.off('model-code-generated');
      EventBus.off('game-focused');
      EventBus.off('request-code-context', this.provideCodeContext, this);
  }

  setActiveTab(tab: Tab) {
    this.activeTab = tab;
  }

  setIframeSubTab(tab: 'preview' | 'code') {
    this.iframeSubTab = tab;
  }

  private executor = new CodeExecutor();

  async buildHtml(prompt: string) {
    if (!this.currentBuildInteraction || !prompt) return;
    
    this.isBuilding = true;
    // Switch to code view to see the stream
    this.setIframeSubTab('code');
    this.rawHtml = '';
    
    // Ensure the ViewChild is available
    this.cdr.detectChanges();

    try {
        const previousHtml = this.currentBuildInteraction.html || '';
        const stream = this.modelService.generateHtmlStream(prompt, previousHtml);
        
        let fullHtml = '';
        for await (const chunk of stream) {
            fullHtml += chunk;
            this.rawHtml = fullHtml;
            // Force change detection to update the textarea value
            this.cdr.detectChanges();
            
            // Scroll to bottom
            if (this.iframeCodeEditor && this.iframeCodeEditor.nativeElement) {
                 this.iframeCodeEditor.nativeElement.scrollTop = this.iframeCodeEditor.nativeElement.scrollHeight;
            }
        }

        // Final cleanup of markdown
        let cleanedHtml = fullHtml.split(/```html|```/i)[1]?.trim() || fullHtml;
        this.rawHtml = cleanedHtml;

        this.safeHtmlContent = this.sanitizer.bypassSecurityTrustHtml(cleanedHtml);
        
        // Save state to interaction so it persists if we walk away and come back (in theory, depending on how `interaction` object is managed upstream)
        this.currentBuildInteraction.html = cleanedHtml; 

        // Switch back to preview to see the result
        this.setIframeSubTab('preview');

    } catch (e) {
        console.error(e);
    } finally {
        this.isBuilding = false;
    }
  }

  clearHtml() {
    if (this.currentBuildInteraction) {
        this.currentBuildInteraction.html = null;
    }
    this.safeHtmlContent = null;
    this.rawHtml = '';
  }

  async runCode() {
    if (!this.currentCodeInteraction) return;

    this.isCodeDirty = false; // Reset on run
    const result = await this.executor.runCode(this.codeContent);
  
    if (result.success) {
      // Format logs and result for display
      const logOutput = result.logs.length > 0 ? `Logs:\n${result.logs.join('\n')}\n` : '';
      this.executionResult = `${logOutput}Result: ${result.output}`;
      
      // Emit your event
      EventBus.emit('run-code-snippet', {
        interaction: this.currentCodeInteraction,
        code: this.codeContent,
        result: result.output
      });
    } else {
      this.executionResult = `Error: ${result.error}`;
      
      // Check if there were logs even during a failure
      if(result.logs.length > 0) {
          this.executionResult += `\nLogs:\n${result.logs.join('\n')}`;
      }
    }
  }

  onEditorFocus() {
    EventBus.emit('lock-input', true);
  }

  onEditorBlur() {
    EventBus.emit('lock-input', false);
  }
}
