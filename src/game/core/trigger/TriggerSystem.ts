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

import { ILevelManager } from '../Interfaces';
import { EventBus } from '../EventBus';
import { TriggerType, TriggerContext, Rule, Action } from './TriggerTypes';
import { PUZZLE_RULES } from './PuzzleRules';
import { executeAction } from './actions/ActionHandlers';

export class TriggerSystem {
    private levelManager: ILevelManager;
    private rules: Rule[] = [];

    constructor(levelManager: ILevelManager) {
        this.levelManager = levelManager;
        this.loadRules();
    }

    private loadRules() {
        this.rules = [...PUZZLE_RULES];
    }

    public processEvent(context: TriggerContext) {
        console.log('TriggerSystem.processEvent called with context:', context);
        let interactionResult = null;
        let matched = false;
        for (const rule of this.rules) {
            if (rule.trigger(context)) {
                console.log(`Rule matched: ${rule.id}`);
                matched = true;
                const actionResult = this.executeActions(rule.actions, context);
                if (actionResult) interactionResult = actionResult;
            }
        }
        
        if (!matched) {
            console.log('No rules matched for this context.');
        }

        if (context.type === TriggerType.MODEL_FUNCTION && context.payload?.name) {
            console.log('Emitting model-tool-execution-result with output:', interactionResult || "Action executed.");
            EventBus.emit('model-tool-execution-result', {
                name: context.payload.name,
                output: interactionResult || "Action executed."
            });
       }
    }

    private executeActions(actions: Action[], context: TriggerContext): string | null {
        let result = null;
        for (const action of actions) {
            const res = executeAction(action.type, this.levelManager, action.params, context);
            if (res) result = res;
        }
        return result;
    }
}
