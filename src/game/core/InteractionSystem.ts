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

import { EventBus } from './EventBus';
import { InteractionType } from './Constants';
import { ILevelManager } from './Interfaces';
import { MovableObject } from './MovableObject';
import { FunctionCallObject } from "../../app/services/model-types";
import { TriggerSystem } from './trigger/TriggerSystem';
import { TriggerType } from './trigger/TriggerTypes';
import { AgentState } from './AgenticNPC';

export class InteractionSystem
{
    private levelManager: ILevelManager;
    private triggerSystem: TriggerSystem;

    constructor(levelManager: ILevelManager)
    {
        this.levelManager = levelManager;
        this.triggerSystem = new TriggerSystem(levelManager);
        this.registerEvents();
    }

    private registerEvents()
    {
        EventBus.on('lock-input', this.handleInputLock, this);
        EventBus.on('model-function-call', this.handleFunctionCall, this);
        EventBus.on('interaction', this.handleInteraction, this);
        EventBus.on('movable-moved', this.handleMovableMoved, this);
        EventBus.on('run-code-snippet', this.handleCodeRun, this);
        EventBus.on('html-puzzle-solved', this.handleHtmlPuzzleSolved, this);
    }

    public unregisterEvents()
    {
        EventBus.off('lock-input', this.handleInputLock, this);
        EventBus.off('model-function-call', this.handleFunctionCall, this);
        EventBus.off('interaction', this.handleInteraction, this);
        EventBus.off('movable-moved', this.handleMovableMoved, this);
        EventBus.off('run-code-snippet', this.handleCodeRun, this);
        EventBus.off('html-puzzle-solved', this.handleHtmlPuzzleSolved, this);
    }

    private handleHtmlPuzzleSolved(data: { interaction: any })
    {
        console.log('HTML Puzzle Solved:', data);
        this.triggerSystem.processEvent({
            type: TriggerType.HTML_PUZZLE_SOLVED,
            payload: data.interaction
        });
    }

    private handleCodeRun(data: { interaction: any, code: string, result: any })
    {
        console.log('Code executed:', data);
        this.triggerSystem.processEvent({
            type: TriggerType.CODE_EXECUTED,
            payload: data
        });
    }

    private handleMovableMoved(data: { movable: MovableObject, gx: number, gy: number })
    {
        const { movable, gx, gy } = data;
        console.log(`Movable ${movable.name} landed on Plate!`);

        this.triggerSystem.processEvent({
            type: TriggerType.MOVABLE_LANDED,
            subject: movable,
            // We could pass the target (Plate/Slot) if we looked it up here, 
            // but the rule can also imply it if we just say "Movable Landed"
        });
    }

    private handleInputLock(locked: boolean)
    {
        if (this.levelManager.player)
        {
            this.levelManager.player.setLocked(locked);
        }
        this.levelManager.agents.forEach(agent => agent.setLocked(locked));
    }

    private handleInteraction(interaction: any)
    {
        switch (interaction.type)
        {
            case InteractionType.PORTAL:
                const link = interaction.linkURL;
                if (link)
                {
                    console.log(`Traversing portal to: ${link}`);
                    this.levelManager.changeLayout(link);
                }
                break;

            case InteractionType.CHAT:
                this.levelManager.movables.forEach(m => m.reset());
                break;

            case InteractionType.SWITCH:
                this.triggerSystem.processEvent({
                    type: TriggerType.INTERACTION,
                    payload: interaction
                });
                if (interaction.instanceId) {
                    this.levelManager.flipObject(interaction.instanceId);
                }
                break;

            case InteractionType.COLLECTIBLE:
                this.levelManager.triggerCollectible(interaction.tag);
                this.levelManager.removeObject(interaction.instanceId);
                break;
        }
    }

    // [START solution_code]
    private handleFunctionCall(call: FunctionCallObject)
    {
        console.log('Received function call:', call);

        const activeAgent = this.levelManager.agents.find(a =>
            a.getState() === AgentState.THINKING || a.getState() === AgentState.EXECUTE
        );

        console.log('Active agent found:', activeAgent?.props.name);

        if (activeAgent)
        {
            activeAgent.incrementToolUse();
            if (activeAgent.getState() === AgentState.FAILED)
            {
                console.warn(`Agent ${activeAgent.props.name} failed due to tool use limit.`);
                return;
            }
        }

        console.log('Calling triggerSystem.processEvent with payload:', call);
        this.triggerSystem.processEvent({
            type: TriggerType.MODEL_FUNCTION,
            payload: call,
            subject: activeAgent
        });
    }
    // [END solution_code]

    // Old helper methods removed as they are now in TriggerSystem
}
