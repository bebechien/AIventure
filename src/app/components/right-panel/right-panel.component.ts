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

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LogService } from '../../services/log.service';
import { MODEL_BACKEND } from '../../services/model-token';
import { ModelBackend } from '../../services/model-backend.interface';
import { EventBus } from '../../../game/core/EventBus';
import { CodeExecutor } from './right-panel.worker';
import { DevsiteAPI } from '../../services/devsite-api';

type Tab = 'code' | 'iframe' | 'logs' | 'draw';

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

  // Draw Interaction
  currentDrawInteraction: any = null;
  @ViewChild('drawCanvas') drawCanvas!: ElementRef<HTMLCanvasElement>;
  private ctx!: CanvasRenderingContext2D;
  private isDrawingOnCanvas = false;
  brushColor = '#00ffcc'; // Default neon teal
  brushSize = 4;
  isEraser = false;
  isEvaluating = false;
  evaluationPassed: boolean | null = null;
  evaluationFeedback = '';
  private lastInitializedInteraction: any = null;

  neonColors = [
    '#00ffcc', // neon teal
    '#ff007f', // neon pink
    '#ffff00', // neon yellow
    '#7f00ff', // neon purple
    '#00ff00', // neon green
    '#ffffff'  // white
  ];
  brushSizes = [2, 4, 8, 16];

  @ViewChild('drawCanvas') set canvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    if (ref && ref.nativeElement) {
      this.drawCanvas = ref;
      // Use setTimeout to ensure Angular lifecycle has completed rendering and canvas can be queried
      setTimeout(() => this.initCanvas(), 0);
    }
  }

  openCredits()
  {
    this.isCreditsVisible = true;
  }

  restartGame()
  {
    EventBus.emit('restart-game');
    this.logService.clearLogs();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.shiftKey && (event.key === 'R' || event.key === 'r')) {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag !== 'textarea' && activeTag !== 'input') {
        event.preventDefault();
        this.restartGame();
      }
    }
  }

  closeCredits()
  {
    this.isCreditsVisible = false;
  }

  openGitHub()
  {
    window.open('https://github.com/bebechien/aiventure', '_blank');
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

    EventBus.on('agent-thought-log', (data: any) => {
      const thoughtLog = this.logService.createStreamableLog({
        summary: `Agent Thought: "${data.name || 'Agent'}"`,
        type: 'log',
        detail: data.text,
        inspect: '',
        sequence: ['phaser', 'angular']
      });
      thoughtLog.finish();
    });

    EventBus.on('collectibles-tracker', (tracker: any) => {
      this.collectiblesTracker = tracker;
      this.cdr.detectChanges(); // Force update if needed
    });

    EventBus.on('collectible-collected', (data: { name: string }) => {
      if (data.name.toLowerCase() === 'diamond') {
        const badgeData = { url: 'https://developers.google.com/profile/badges/playlists/solutions/aiventure/reward' };
        console.log('Awarding diamond badge: ', badgeData);

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

    EventBus.on('visible-draw-interaction', (interaction: any) => {
      this.currentDrawInteraction = interaction;
      if (interaction) {
        this.setActiveTab('draw');
        this.evaluationPassed = null;
        this.evaluationFeedback = '';
      } else {
        this.lastInitializedInteraction = null;
      }
      this.cdr.detectChanges();
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
      EventBus.off('visible-draw-interaction');
      EventBus.off('build-html-request');
      EventBus.off('model-code-generated');
      EventBus.off('game-focused');
      EventBus.off('agent-thought-log');
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

    const sendLog = this.logService.createStreamableLog({
      summary: `Sending to Model, user prompt: "${prompt}"`,
      type: 'log',
      detail: `Build Interaction HTML request.\nPrevious HTML:\n${this.currentBuildInteraction.html || 'None'}`,
      inspect: '',
      sequence: ['angular', 'local-gemma']
    });
    sendLog.finish();

    const responseLog = this.logService.createStreamableLog({
      summary: `Model Response (HTML Build)`,
      type: 'log',
      inspect: '',
      sequence: ['local-gemma', 'angular']
    });

    try {
        const previousHtml = this.currentBuildInteraction.html || '';
        const stream = this.modelService.generateHtmlStream(prompt, previousHtml);
        
        let fullHtml = '';
        for await (const chunk of stream) {
            fullHtml += chunk;
            this.rawHtml = fullHtml;
            responseLog.append(chunk);
            // Force change detection to update the textarea value
            this.cdr.detectChanges();
            
            // Scroll to bottom
            if (this.iframeCodeEditor && this.iframeCodeEditor.nativeElement) {
                 this.iframeCodeEditor.nativeElement.scrollTop = this.iframeCodeEditor.nativeElement.scrollHeight;
            }
        }
        responseLog.append('\nModel Stream Complete.');
        responseLog.finish();

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
        responseLog.append(`\nModel Stream Error: ${e}`);
        responseLog.finish();
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

  // Draw Canvas Methods
  initCanvas() {
    if (!this.drawCanvas || !this.drawCanvas.nativeElement || !this.currentDrawInteraction) return;
    const canvas = this.drawCanvas.nativeElement;
    
    if (this.lastInitializedInteraction === this.currentDrawInteraction) {
      // Keep canvas drawing intact across state updates / evaluation submissions
      this.ctx = canvas.getContext('2d')!;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      return;
    }

    canvas.width = 300;
    canvas.height = 300;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.clearCanvas();
    
    this.lastInitializedInteraction = this.currentDrawInteraction;
  }

  private getCanvasCoords(event: MouseEvent | TouchEvent): { x: number; y: number } {
    const canvas = this.drawCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event instanceof TouchEvent) {
      if (event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
      }
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  startDrawing(event: MouseEvent) {
    if (!this.currentDrawInteraction) return;
    this.isDrawingOnCanvas = true;
    const coords = this.getCanvasCoords(event);
    this.ctx.beginPath();
    this.ctx.moveTo(coords.x, coords.y);
    this.onEditorFocus();
  }

  draw(event: MouseEvent) {
    if (!this.isDrawingOnCanvas || !this.currentDrawInteraction) return;
    const coords = this.getCanvasCoords(event);
    this.ctx.strokeStyle = this.isEraser ? '#111111' : this.brushColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineTo(coords.x, coords.y);
    this.ctx.stroke();
  }

  stopDrawing() {
    this.isDrawingOnCanvas = false;
    this.onEditorBlur();
  }

  startDrawingTouch(event: TouchEvent) {
    if (!this.currentDrawInteraction) return;
    event.preventDefault();
    this.isDrawingOnCanvas = true;
    const coords = this.getCanvasCoords(event);
    this.ctx.beginPath();
    this.ctx.moveTo(coords.x, coords.y);
    this.onEditorFocus();
  }

  drawTouch(event: TouchEvent) {
    if (!this.isDrawingOnCanvas || !this.currentDrawInteraction) return;
    event.preventDefault();
    const coords = this.getCanvasCoords(event);
    this.ctx.strokeStyle = this.isEraser ? '#111111' : this.brushColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineTo(coords.x, coords.y);
    this.ctx.stroke();
  }

  clearCanvas() {
    if (!this.ctx) return;
    this.ctx.fillStyle = '#111111';
    this.ctx.fillRect(0, 0, this.drawCanvas.nativeElement.width, this.drawCanvas.nativeElement.height);
  }

  selectColor(color: string) {
    this.brushColor = color;
    this.isEraser = false;
  }

  toggleEraser() {
    this.isEraser = !this.isEraser;
  }

  async submitDrawing() {
    if (!this.currentDrawInteraction || this.isEvaluating) return;

    const canvas = this.drawCanvas.nativeElement;
    const imageBase64 = canvas.toDataURL('image/png');

    this.isEvaluating = true;
    this.evaluationPassed = null;
    this.evaluationFeedback = '';
    this.cdr.detectChanges();

    const prompt = this.currentDrawInteraction.chatResponse;
    const resultLog = this.logService.createStreamableLog({
      summary: `Evaluating drawing: "${prompt}"`,
      type: 'log',
      detail: `Player drawing submitted for prompt: "${prompt}".\nStarting multimodal AI evaluation...`,
      inspect: '',
      sequence: ['angular', 'local-gemma']
    });

    try {
      if (this.modelService.evaluateDrawing) {
        const response = await this.modelService.evaluateDrawing(prompt, imageBase64);
        this.evaluationPassed = response.success;
        this.evaluationFeedback = response.feedback;

        resultLog.append(`\nAI Evaluation complete.\nResult: ${response.success ? 'PASSED' : 'FAILED'}\nFeedback: ${response.feedback}`);
        resultLog.finish();

        if (response.success) {
          EventBus.emit('draw-puzzle-solved', {
            interaction: this.currentDrawInteraction
          });
        }
      } else {
        throw new Error('Drawing evaluation is not supported by current model backend.');
      }
    } catch (e: any) {
      console.error(e);
      this.evaluationPassed = false;
      this.evaluationFeedback = 'Error reaching AI evaluator. Please try again!';
      resultLog.append(`\nEvaluation Error: ${e.message || e}`);
      resultLog.finish();
    } finally {
      this.isEvaluating = false;
      this.cdr.detectChanges();
    }
  }
}
